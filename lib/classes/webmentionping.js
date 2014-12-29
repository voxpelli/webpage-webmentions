/*jslint node: true */
/* global -Promise */

"use strict";

var url = require('url'),
  _ = require('lodash'),
  request = require('../utils/request'),
  cheerio = require('cheerio'),
  microformats = require('microformat-node'),
  Promise = require('promise'),
  knex = require('../knex'),
  options = require('../config'),
  urlTools = require('../utils/url-tools'),
  throttledKeys = {},
  throttleTimestamp,
  throttleByKey,
  WebMentionPing;

//TODO: Sync throttle between workers
//TODO: Ensure that the throttle persists between reboots of the app (enable eg. quick shutdowns on SIGTERM)
throttleByKey = function (key, onWaitCallback) {
  return new Promise(function (resolve, reject) {
    var now = Date.now(), time = Math.floor(now / options.throttleSpan), wait, err;

    if (
      (options.env === 'development' || options.env === 'test') &&
      !options.dev.throttling &&
      (key === '127.0.0.1' || key === 'localhost' || key === 'example.com')
    ) {
      // Don't throttle local pings in development and test environments
    } else if (throttleTimestamp !== time) {
      // Divide the time into timeslots and open up new requests whenever there's a new timeslot
      throttleTimestamp = time;
      throttledKeys = {};
    } else if (throttledKeys[key]) {
      if (!options.throttleCap || throttledKeys[key] < options.throttleCap) {
        // We're throttled – lets wait and try again when there's a new timeslot!

        //TODO: What is happening here? The throttleSpan tells the minimum gap between each request – yet all requests are scheduled to practially retry at the same time? Is that because we need to reinitialize throttledKeys[key] variable on each timeSpan and therefore need all requests to reregister again? Surely there can be a more elegant solution to that.
        wait = (time + 1) * options.throttleSpan - now + throttledKeys[key];
        console.log('Throttled! In', wait, 'milliseconds retrying key:', key);

        setTimeout(function () {
          throttleByKey(key).then(resolve, reject);
        }, wait);
        throttledKeys[key] += 1;

        if (onWaitCallback) {
          // If we need to wait, then we might want to eg. respond to the browser early
          onWaitCallback();
        }

        return;
      } else {
        // We're throttled – but there's too many waiting already so we won't get in line

        console.log('Reached throttle cap of', options.throttleCap, 'for key:', key);
        err = new Error('Too many mentions from source host at the moment.');
        err.status = 503;
        // Suggest that they ping again once we have emptied the queue so that we can fill it back up again
        // The requests will get throttled right away if they do this, but it will ensure that we utilize
        // the defined throttleSpan to the fullest and never stand idle for a millisecond.
        //
        // This should perhaps be set to just the time when there's any free spot in the queue at all, even
        // if that would mean that the throttleCap would be reached immediately again. Would follow the spec
        // more closely though: http://tools.ietf.org/html/rfc7231#section-7.1.3
        err.retryAfter = Math.ceil(((time + throttledKeys[key] - 1) * options.throttleSpan - now) / 1000);
        reject(err);

        return;
      }
    }

    // Nothing is stopping us – all lights are green – go go go!
    throttledKeys[key] = 1;
    resolve();
  });
};

WebMentionPing = function (source, target) {
  this.source = source;
  this.target = target;

  this.normalizedSource = urlTools.normalizeUrl(source);
  this.normalizedTarget = urlTools.normalizeUrl(target);

  this.sourceHost = url.parse(this.normalizedSource).hostname;
  this.targetHost = url.parse(this.normalizedTarget).hostname;
};

WebMentionPing.prototype.interactionMapping = {
  'reply': 'in-reply-to',
  'like': 'like-of',
  'repost': 'repost-of',
};

WebMentionPing.prototype.isValidTarget = function () {
  return knex('sites').first('aid').where('hostname', this.targetHost).then(function (row) {
    if (!row) {
      console.log('Invalid target site:', this.targetHost);

      var err = new Error('Invalid target site');
      err.status = 400;
      throw(err);
    }
  }.bind(this));
};

WebMentionPing.prototype.throttleFetches = function (onWaitCallback) {
  return throttleByKey(this.sourceHost, onWaitCallback);
};

WebMentionPing.prototype.fetchSourcePage = function () {
  return new Promise(function (resolve, reject) {
    request({ uri: this.source }, function (err, response, body) {
      if (err) {
        reject(err);
      } else if (response.statusCode !== 200) {
        reject(new Error('Expected HTTP code 200'));
      } else {
        resolve(body);
      }
    });
  }.bind(this));
};

WebMentionPing.prototype.parseSourcePage = function (body) {
  var $, links, linked, i, length, href, sourceParts;

  $ = cheerio.load(body);
  links = $('a');
  linked = false;

  for (i = 0, length = links.length; i < length; i += 1) {
    href = links.eq(i).attr('href');
    try {
      if (href && urlTools.normalizeUrl(href, { relativeTo: this.normalizedSource }) === this.normalizedTarget) {
        linked = true;
        break;
      }
    } catch (e) {}
  }

  if (!linked) {
    console.log("Couldn't find a link from source to target", this.source, this.target);
    return Promise.reject(new Error("Couldn't find a link from source to target (" + this.target + ")"));
  } else {
    sourceParts = url.parse(this.source);
    return Promise.denodeify(microformats.parseDom)($, $.root(), {
      filters : ['h-entry'],
      logLevel : 0,
      baseUrl: sourceParts.protocol + '//' + sourceParts.host + sourceParts.path,
    });
  }
};

WebMentionPing.prototype.createMention = function (data) {
  var entry = {},
    now = Date.now(),
    item,
    author,
    published;

  if (data.items.length) {
    item = data.items[0].properties;
    author = item.author ? item.author[0].properties : {};
    published = item.published ? Date.parse(item.published[0]) : null;

    entry.url = item.url ? url.resolve(this.source, item.url[0]) : this.source;
    entry.name = item.name ? item.name[0] : null;
    entry.published = published || now;
    entry.summary = item.summary ?
      item.summary[0] :
      (item.content ? item.content[0].value : null);

    entry.author = {
      name : author.name ? author.name[0] : null,
      photo : author.photo ? url.resolve(this.source, author.photo[0]) : null,
      url : author.url ? url.resolve(this.source, author.url[0]) : null
    };

    // Find the kind of interaction this is and what the interaction targets are. Stop at first find.
    _.some(this.interactionMapping, function (key, type) {
      if (item[key] && item[key].length) {
        entry.interactionType = type;
        entry.interactions = item[key];
        return true;
      }
    });

    if (entry.name === entry.summary) {
      entry.name = null;
    }

    if (entry.summary && entry.summary.length > 512) {
      entry.summary = entry.summary.substr(0, 512);
    }

    if (entry.interactions) {
      entry.interactions = _.compact(_.uniq(_.map(entry.interactions, function (target) {
        if (_.isObject(target) && target.properties.url) {
          target = target.properties.url[0];
        } else if (!_.isString(target)) {
          return null;
        }
        return url.resolve(this.source, target);
      }.bind(this))));
    }

    // XSS protection, stop non-HTTP protocols
    if (!urlTools.isHttpUrl.test(entry.url)) {
      entry.url = this.source;
    }
    if (!urlTools.isHttpUrl.test(entry.author.url)) {
      entry.author.url = null;
    }
  } else {
    entry.published = now;
  }

  return {
    url : this.source,
    normalizedUrl : this.normalizedSource,
    published : new Date(entry.published),
    fetched : new Date(now),
    type: entry.interactionType || null,
    data : entry,
    raw : data
  };
};

WebMentionPing.prototype.saveMention = function (mention) {
  return knex.transaction(function (trx) {
    return trx
      .table('entries').insert(mention, 'id')
      .then(function (id) {
        return Promise.all([

          trx.table('mentions').insert({
            url : this.target,
            normalizedUrl : this.normalizedTarget,
            interaction : mention.type && _.some(mention.data.interactions, function (target) {
              return urlTools.normalizeUrl(target, { relativeTo: this.normalizedSource }) === this.normalizedTarget;
            }.bind(this)) ? true : false,
            eid : id[0],
            hostname : this.targetHost
          }),

          trx.table('sites').update('lastmention', knex.fn.now()).where('hostname', this.targetHost)

        ]).then(function () {
          knex.raw("NOTIFY mentions, '" + JSON.stringify({
            eid : id[0],
          }) + "'").exec();
        }.bind(this));
      }.bind(this));
  }.bind(this));
};

module.exports = WebMentionPing;
