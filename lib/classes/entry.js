/*jslint node: true */

"use strict";

var url = require('url'),
  _ = require('lodash'),
  moment = require('moment'),
  knex = require('../knex'),
  urlTools = require('../utils/url-tools'),
  Entry;

Entry = function (source, metadata) {
  this.source = source;

  this.normalizedSource = urlTools.normalizeUrl(source);
  this.sourceHost = url.parse(this.normalizedSource).hostname;
  this.sourceBase = this.source;

  this.newTargets = {};

  this.setData(metadata);
};

Entry.prototype.interactionMapping = {
  'reply': 'in-reply-to',
  'like': 'like-of',
  'repost': 'repost-of',
};

Entry.prototype.getHrefs = function () {
  return this.data.raw.hrefs;
};

Entry.prototype.hasTarget = function (target) {
  return this.getHrefs().indexOf(urlTools.normalizeUrl(target)) !== -1;
};

Entry.prototype.addTarget = function (target) {
  if (!this.hasTarget(target)) { return false; }

  this.newTargets[urlTools.normalizeUrl(target)] = target;

  return true;
};

Entry.prototype.getData = function () {
  return this.data;
};

Entry.prototype.setData = function (metadata) {
  var data = metadata.microformats,
    entry = {},
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

  this.data = {
    url : this.source,
    normalizedUrl : this.normalizedSource,
    published : new Date(entry.published),
    fetched : new Date(now),
    updated : new Date(now),
    type: entry.interactionType || null,
    data : entry,
    raw : metadata,
    mfversion : metadata.microformatsVersion,
  };
};

Entry.prototype._isInteractionTarget = function (entry, normalizedTarget) {
  return entry.type && _.some(entry.data.interactions, function (target) {
    return urlTools.normalizeUrl(target, { relativeTo: this.sourceBase }) === normalizedTarget;
  }.bind(this)) ? true : false;
};

Entry.prototype._upsert = function () {
  var entry = this.getData(),
    updated,
    updateMention;

  updateMention = function () {
    return knex.table('entries')
      .where('normalizedUrl', entry.normalizedUrl)
      .update({
        updated: entry.fetched,
        type: entry.type,
        data : entry.data,
        raw : entry.raw,
        mfversion : entry.mfversion,
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
      this.id = id[0];
      return updated;
    });
};

Entry.prototype._updateOrDeleteExistingMentions = function (updated) {
  var id = this.id,
    entry = this.getData();

  // If new entry, then no existing mentions exists
  if (!updated) {
    return Promise.resolve();
  }

  //TODO: Add test for entry updates and mention updates / removal
  return knex.table('mentions').where('eid', id).select().bind(this).then(function (existingMentions) {
    var updates = _.map(existingMentions, function (existingMention) {
      var isCurrentMention, update = {};

      if (this.newTargets[existingMention.normalizedUrl]) {
        delete this.newTargets[existingMention.normalizedUrl];
        isCurrentMention = true;
      }

      if (isCurrentMention || this.hasTarget(existingMention.normalizedUrl)) {
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

    return Promise.all(updates);
  });
};

Entry.prototype._insertMention = function () {
  var self = this,
    id = this.id,
    entry = this.getData();

  return Promise.all(_.map(this.newTargets, function (target, normalizedTarget) {
    var targetHost = url.parse(normalizedTarget).hostname;

    return Promise.all([
      knex.table('sites').update('lastmention', knex.fn.now()).where('hostname', targetHost),
      knex.table('mentions').insert({
        url : target,
        normalizedUrl : normalizedTarget,
        interaction : self._isInteractionTarget(entry, normalizedTarget),
        eid : id,
        hostname : targetHost
      })
      .catch(function (err) {
        if (err.code === '23505') {
          // Unique constraint error, ignore
        } else {
          throw err;
        }
      }),
    ]);
  }));
};

Entry.prototype._notify = function () {
  return knex.raw("NOTIFY mentions, '" + JSON.stringify({ eid : this.id, }) + "'").exec();
};

Entry.prototype.save = function () {
  return this._upsert()
    .then(this._updateOrDeleteExistingMentions.bind(this))
    .then(this._insertMention.bind(this))
    .then(this._notify.bind(this));
};

module.exports = Entry;
