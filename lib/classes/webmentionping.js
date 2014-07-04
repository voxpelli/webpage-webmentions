"use strict";

var url = require('url'),
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
      options.env === 'development' &&
      !options.dev.throttling &&
      (key === '127.0.0.1' || key === 'localhost')
    ) {
      // Don't throttle local pings in development environments
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
  var $, links, linked, i, length, href;

  $ = cheerio.load(body);
  links = $('a');
  linked = false;

  for (i = 0, length = links.length; i < length; i += 1) {
    href = links.eq(i).attr('href');
    if (href && urlTools.normalizeUrl(href, this.normalizedSource) === this.normalizedTarget) {
      linked = true;
      break;
    }
  }

  if (!linked) {
    console.log("Couldn't find a link from source to target", this.source, this.target);
    return Promise.reject(new Error("Couldn't find a link from source to target (" + this.target + ")"));
  } else {
    console.info('Microformatparsing');
    return Promise.denodeify(microformats.parseDom)($, $.root(), {
      filters : ['h-entry']
    });
  }
};

WebMentionPing.prototype.createMention = function (data) {
  var entryUrl = this.source,
    entry = {},
    item,
    author;

  if (data.items.length) {
    item = data.items[0].properties;
    entryUrl = item.url ? url.resolve(this.source, item.url[0]) : this.source;
    author = item.author ? item.author[0].properties : {};

    entry.name = item.name ? item.name[0] : null;
    entry.published = item.published ? Date.parse(item.published[0]) : Date.now();
    entry.summary = item.summary ?
      item.summary[0] :
      (item.content ? item.content[0].value : null);

    entry.author = {
      name : author.name ? author.name[0] : null,
      photo : author.photo ? url.resolve(this.source, author.photo[0]) : null,
      url : author.url ? url.resolve(this.source, author.url[0]) : null
    };

    if (entry.name === entry.summary) {
      entry.name = null;
    }

    if (entry.summary.length > 512) {
      entry.summary = entry.summary.substr(0, 512);
    }
  } else {
    entry.published = Date.now();
  }

  return {
    url : entryUrl,
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
            eid : id[0],
            hostname : this.targetHost
          }),

          trx.table('sites').update('lastmention', knex.raw('NOW()')).where('hostname', this.targetHost)

        ]);
      }.bind(this));
  }.bind(this));
};

module.exports = WebMentionPing;
