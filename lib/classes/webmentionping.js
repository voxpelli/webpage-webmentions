/*jslint node: true */

"use strict";

var url = require('url'),
  _ = require('lodash'),
  request = require('../utils/request'),
  cheerio = require('cheerio'),
  microformats = require('microformat-node'),
  microformatsVersion = require('microformat-node/package.json').version,
  moment = require('moment'),
  knex = require('../knex'),
  urlTools = require('../utils/url-tools'),
  WebMentionPing;

WebMentionPing = function (source, target) {
  this.source = source;
  this.target = target;

  this.normalizedSource = urlTools.normalizeUrl(source);
  this.normalizedTarget = urlTools.normalizeUrl(target);

  this.sourceHost = url.parse(this.normalizedSource).hostname;
  this.targetHost = url.parse(this.normalizedTarget).hostname;

  this.sourceBase = this.source;
};

WebMentionPing.prototype.interactionMapping = {
  'reply': 'in-reply-to',
  'like': 'like-of',
  'repost': 'repost-of',
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

WebMentionPing.prototype.findLink = function (normalizedTarget) {
  var i, length, href,
    links = this.$('a'),
    linked = false;

  for (i = 0, length = links.length; i < length; i += 1) {
    href = links.eq(i).attr('href');
    try {
      if (href && urlTools.normalizeUrl(href, { relativeTo: this.sourceBase }) === normalizedTarget) {
        linked = true;
        break;
      }
    } catch (e) {}
  }

  return linked;
};

WebMentionPing.prototype.parseSourcePage = function (body) {
  var $, $mf, base, linked, err, sourceParts;

  $ = cheerio.load(body);

  this.$ = $;

  base = $('base').attr('href');

  if (base) {
    this.sourceBase = url.resolve(this.source, base);
  }

  linked = this.findLink(this.normalizedTarget);

  if (!linked) {
    console.log("Couldn't find a link from source to target", this.source, this.target);
    err = new Error("Couldn't find a link from source to target (" + this.target + ")");
    err.name = 'WebMentionPingError';
    return Promise.reject(err);
  } else {
    sourceParts = url.parse(this.source);
    $mf = cheerio.load(body);
    return new Promise(function (resolve, reject) {
      microformats.parseDom($mf, $mf.root(), {
        filters : ['h-entry'],
        logLevel : 0,
        baseUrl: sourceParts.protocol + '//' + sourceParts.host + sourceParts.path,
      }, function (err, data) {
        if (err) { return reject(err); }
        resolve(data);
      });
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
    if (item.published) {
      published = moment.utc(item.published[0]);
      published = published.isValid() ? published.valueOf() : null;
    } else {
      published = null;
    }

    entry.url = item.url ? url.resolve(this.sourceBase, item.url[0]) : this.source;
    entry.name = item.name ? item.name[0] : null;
    entry.published = published || now;
    entry.summary = item.summary ?
      item.summary[0] :
      (item.content ? item.content[0].value : null);

    entry.author = {
      name : author.name ? author.name[0] : null,
      photo : author.photo ? url.resolve(this.sourceBase, author.photo[0]) : null,
      url : author.url ? url.resolve(this.sourceBase, author.url[0]) : null
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
        return url.resolve(this.sourceBase, target);
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
    updated : new Date(now),
    type: entry.interactionType || null,
    data : entry,
    raw : data,
    mfversion : microformatsVersion,
  };
};

WebMentionPing.prototype._isInteractionTarget = function (entry, normalizedTarget) {
  return entry.type && _.some(entry.data.interactions, function (target) {
    return urlTools.normalizeUrl(target, { relativeTo: this.sourceBase }) === normalizedTarget;
  }.bind(this)) ? true : false;
};

WebMentionPing.prototype._upsertEntry = function (entry) {
  var updated, updateMention;

  updateMention = function () {
    return knex.table('entries')
      .where('normalizedUrl', entry.normalizedUrl)
      .update({
        updated: entry.fetched,
        type: entry.type,
        data : entry.data,
        raw : entry.raw,
        mfversion : microformatsVersion,
      }, 'id').then(function (id) {
        if (id[0]) {
          updated = true;
        }
        return id;
      });
  };

  return updateMention()
    .bind(this)
    .then(function (id) {
      return id.length ? id : knex.table('entries').insert(entry, 'id');
    })
    .catch(function (err) {
      // Unique constraint error
      if (err.code === '23505') {
        return updateMention();
      } else {
        throw err;
      }
    }).then(function (id) {
      return {
        id: id[0],
        entry: entry,
        updated: updated,
      };
    });
};

WebMentionPing.prototype._updateOrDeleteExistingMentions = function (data) {
  var id = data.id,
    entry = data.entry;

  // If new entry, then no existing mentions exists
  if (!data.updated) {
    return Promise.resolve({
      id: id,
      entry: entry,
      newMention: true,
    });
  }

  //TODO: Add test for entry updates and mention updates / removal
  return knex.table('mentions').where('eid', id).select().bind(this).then(function (existingMentions) {
    var newMention = true;

    var updates = _.map(existingMentions, function (existingMention) {
      var isCurrentMention, update = {};

      if (newMention && existingMention.normalizedUrl === this.normalizedTarget) {
        isCurrentMention = true;
        newMention = false;
      }

      if (isCurrentMention || this.findLink(existingMention.normalizedUrl)) {
        update.removed = false;
        update.interaction = this._isInteractionTarget(entry, existingMention.normalizedUrl);
      } else {
        update.removed = true;
      }

      update = _.omit(update, function (value, property) {
        return existingMention[property] === value;
      });

      if (!_.isEmpty(update)) {
        update.updated = entry.fetched;

        update = knex.table('mentions')
          .where('eid', id)
          .where('normalizedUrl', existingMention.normalizedUrl)
          .update(update);
      }

      return update;
    }, this);

    return Promise.all(updates).then(function () {
      return {
        id: id,
        entry: entry,
        newMention: newMention,
      };
    });
  });
};

WebMentionPing.prototype._insertMention = function (data) {
  var id = data.id,
    entry = data.entry,
    updates = [];

  if (!data.newMention) {
    return Promise.resolve(id);
  }

  updates.push(knex.table('sites').update('lastmention', knex.fn.now()).where('hostname', this.targetHost));
  updates.push(
    knex.table('mentions').insert({
      url : this.target,
      normalizedUrl : this.normalizedTarget,
      interaction : this._isInteractionTarget(entry, this.normalizedTarget),
      eid : id,
      hostname : this.targetHost
    })
    .catch(function (err) {
      if (err.code === '23505') {
        // Unique constraint error, ignore
      } else {
        throw err;
      }
    })
  );

  return Promise.all(updates).then(function () {
    return id;
  });
};

WebMentionPing.prototype.saveMention = function (mention) {
  return this._upsertEntry(mention)
    .then(this._updateOrDeleteExistingMentions.bind(this))
    .then(this._insertMention.bind(this))
    .then(function (id) {
      return knex.raw("NOTIFY mentions, '" + JSON.stringify({ eid : id, }) + "'").exec();
    });
};

module.exports = WebMentionPing;
