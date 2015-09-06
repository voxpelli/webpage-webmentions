/*jslint node: true */

"use strict";

var url = require('url'),
  _ = require('lodash'),
  moment = require('moment'),
  knex = require('../knex'),
  urlTools = require('../utils/url-tools'),
  Entry;

Entry = function (source, metadata, options) {
  options = options || {};

  this.requestBroker = options.requestBroker;

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

Entry.prototype.addTarget = function (target, direct) {
  if (!this.hasTarget(target)) { return false; }

  this.newTargets[urlTools.normalizeUrl(target)] = {
    target: target,
    direct: direct || false,
  };

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

    this.responses = _.filter((item.responses || []).map(function (responses) {
      var url = responses.value || responses;
      if (url && urlTools.isHttpUrl.test(url)) {
        return url;
      }
    }));

    this.comments = _.filter((item.comment || []).map(function (comment) {
      var url = comment.value || comment;

      if (!urlTools.isHttpUrl.test(url)) {
        url = comment.properties || {};
        url = url.url || [];
        url = url[0];
      }

      if (url && urlTools.isHttpUrl.test(url)) {
        return url;
      }
    }));

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

Entry.prototype.getWebMentionEndpoint = function () {
  //TODO: Complete this one
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
      // .whereNot('data', entry.data)
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
      var isCurrentMention, isDirectTarget, update = {};

      if (this.newTargets[existingMention.normalizedUrl]) {
        isDirectTarget = this.newTargets[existingMention.normalizedUrl].direct;
        isCurrentMention = true;
        delete this.newTargets[existingMention.normalizedUrl];
      }

      if (isCurrentMention || this.hasTarget(existingMention.normalizedUrl)) {
        update.removed = false;
        update.interaction = this._isInteractionTarget(entry, existingMention.normalizedUrl);

        if (isCurrentMention) {
          update.directTarget = isDirectTarget;
        }
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
        url : target.target,
        normalizedUrl : normalizedTarget,
        interaction : self._isInteractionTarget(entry, normalizedTarget),
        eid : id,
        hostname : targetHost,
        directTarget: target.direct,
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

Entry.prototype._ping = function () {
  //TODO: Check if this entry or any of the parents of this entry is a target and then WebMention all the URL:s interacted with by that target (maybe all URL:s that doesn't have a rel-nofollow even?)

  //TODO: Step 1: Find all relevant pages that we might want to send out pings for – this entry and all parent entries – filtered by which ones we're responsible for and if those we are responsible for has activated Salmention / WebMention pinging
  //TODO: Step 2: Find all pages mentioned/interacted with by those pages
  //TODO: Step 3: Find the WebMention endpoints of all of those pages
  //TODO: Step 4: Send a WebMention ping for each and every one of those source/target combinations
};

Entry.prototype._fetchComments = function () {
  var self = this;
  var normalizedSource = this.normalizedSource;

  this.responses.forEach(function (url) {
    self.requestBroker.add('metadata', url, {
      responsesFor: normalizedSource,
    });
  });

  this.comments.forEach(function (url) {
    self.requestBroker.add('metadata', url, {
      commentOf: normalizedSource,
    });
  });
};

Entry.prototype.save = function () {
  return this._upsert()
    .then(this._updateOrDeleteExistingMentions.bind(this))
    .then(this._insertMention.bind(this))
    //TODO: Make these last things in parallell
    //TODO: Check if updated prior to _notify(), _ping() and maybe _fetchComments()
    //TODO: When done – send WebMentions for this – and only send one – so wait for all comments to be fetched (or to fail)
    //TODO: First step though – just send WebMentions!
    .then(this._notify.bind(this))
    .then(this._ping.bind(this))
    .then(this._fetchComments.bind(this));
};

module.exports = Entry;
