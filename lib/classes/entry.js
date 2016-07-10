/* jslint node: true */

'use strict';

const urlModule = require('url');
const _ = require('lodash');
const moment = require('moment');
const mfTools = require('../utils/mf-tools');
const urlTools = require('../utils/url-tools');

const Entry = function (source, metadata, options) {
  options = options || {};

  this.knex = options.knex;
  this.requestBroker = options.requestBroker;
  // this.entryCollection = options.entryCollection;

  this.source = source;

  this.normalizedSource = urlTools.normalizeUrl(source);
  this.sourceHost = urlModule.parse(this.normalizedSource).hostname;
  this.sourceBase = this.source;

  this.newTargets = {};

  this.setData(metadata);
};

Entry.prototype.interactionMapping = {
  'reply': 'in-reply-to',
  'like': 'like-of',
  'repost': 'repost-of'
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
    direct: direct || false
  };

  return true;
};

Entry.prototype.getData = function () {
  return this.data;
};

Entry.prototype.setData = function (metadata) {
  const data = metadata.microformats;
  const entry = {};
  const now = Date.now();

  if (data.items.length) {
    let item = data.items[0].properties;
    let author = item.author ? item.author[0].properties : {};
    let published;

    if (item.published) {
      published = moment.utc(item.published[0]);
      published = published.isValid() ? published.valueOf() : null;
    } else {
      published = null;
    }

    entry.url = item.url ? urlModule.resolve(this.sourceBase, item.url[0]) : this.source;
    entry.name = item.name ? item.name[0] : null;
    entry.published = published || now;
    entry.summary = item.summary
      ? item.summary[0]
      : (item.content ? item.content[0].value : null);

    entry.author = {
      name: author.name ? author.name[0] : null,
      photo: author.photo ? urlModule.resolve(this.sourceBase, author.photo[0]) : null,
      url: author.url ? urlModule.resolve(this.sourceBase, author.url[0]) : null
    };

    this.responses = _.filter((item.responses || []).map(function (responses) {
      var url = responses.value || responses;
      if (url && urlTools.isHttpUrl.test(url)) {
        return url;
      }
    }));

    this.comments = _.filter((item.comment || []).map(function (comment) {
      return (mfTools.getUValues(comment) || [])[0];
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
        return urlModule.resolve(this.sourceBase, target);
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
    url: this.source,
    normalizedUrl: this.normalizedSource,
    published: new Date(entry.published),
    fetched: new Date(now),
    updated: new Date(now),
    type: entry.interactionType || null,
    data: entry,
    raw: metadata,
    mfversion: metadata.microformatsVersion
  };
};

Entry.prototype._isInteractionTarget = function (entry, normalizedTarget) {
  return entry.type && _.some(entry.data.interactions, function (target) {
    return urlTools.normalizeUrl(target, { relativeTo: this.sourceBase }) === normalizedTarget;
  }.bind(this));
};

Entry.prototype._upsert = function () {
  const knex = this.knex;
  const entry = this.getData();
  let updated;

  let updateMention = function () {
    return knex.table('entries')
      .where('normalizedUrl', entry.normalizedUrl)
      // .whereNot('data', entry.data)
      .update({
        updated: entry.fetched,
        type: entry.type,
        data: entry.data,
        raw: entry.raw,
        mfversion: entry.mfversion
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
  // If new entry, then no existing mentions exists
  if (!updated) {
    return Promise.resolve();
  }

  const knex = this.knex;
  const id = this.id;
  const entry = this.getData();

  // TODO: Add test for entry updates and mention updates / removal
  return knex.table('mentions').where('eid', id).select().bind(this).then(function (existingMentions) {
    var updates = _.map(existingMentions, function (existingMention) {
      let update = {};
      let isCurrentMention, isDirectTarget;

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
  const knex = this.knex;
  const self = this;
  const id = this.id;
  const entry = this.getData();

  return Promise.all(_.map(this.newTargets, function (target, normalizedTarget) {
    var targetHost = urlModule.parse(normalizedTarget).hostname;

    return Promise.all([
      knex.table('sites').update('lastmention', knex.fn.now()).where('hostname', targetHost),
      knex.table('mentions').insert({
        url: target.target,
        normalizedUrl: normalizedTarget,
        interaction: self._isInteractionTarget(entry, normalizedTarget),
        eid: id,
        hostname: targetHost,
        directTarget: target.direct
      })
      .catch(function (err) {
        if (err.code === '23505') {
          // Unique constraint error, ignore
        } else {
          throw err;
        }
      })
    ]);
  }));
};

Entry.prototype._notify = function () {
  return this.knex.raw("NOTIFY mentions, '" + JSON.stringify({ eid: this.id }) + "'").exec();
};

// TODO: Move these new methods to better locations in the file
Entry.prototype.getWebMentionEndpoints = function () {
  return _.uniq(this.getData().raw.links.webmention || []);
};

Entry.prototype.getAllSalmentionTargets = function () {
  var knex = this.knex;

  // TODO: Move "directTarget" resolve to instead check of "hostname" exists in "sites" – if it does, then it's a direct target

  var query = knex('mentions')
    .select('mentions.eid', knex.raw('0'), 'mentions.normalizedUrl', 'mentions.url', 'mentions.directTarget', 'mentions.hostname')
    .innerJoin('entries', 'entries.id', 'mentions.eid')
    .where('entries.normalizedUrl', this.normalizedSource)
    .where('mentions.removed', false)
    .union(function () {
      this.select('mentions.eid', 'allmentions.eid', 'mentions.normalizedUrl', 'mentions.url', 'mentions.directTarget', 'mentions.hostname')
        .from('mentions')
        .innerJoin('entries', 'entries.id', 'mentions.eid')
        .innerJoin('allmentions', 'entries.normalizedUrl', 'allmentions.normalizedUrl')
        .where('mentions.removed', false);
    });

  var filterQuery = knex('allmentions')
    .distinct('allmentions.url')
    .innerJoin('sites', 'sites.hostname', 'allmentions.hostname')
    .where('allmentions.directTarget', true)
    .where('sites.salmentions', true);

  return knex.raw('WITH RECURSIVE "allmentions"("eid", "parentId", "normalizedUrl", "url", "directTarget", "hostname") AS (' + query + ') ' + filterQuery + '')
    .then(function (result) {
      return result.rows.map(function (row) {
        return row.url;
      });
    });
};

Entry.prototype._extractInteractions = function () {
  var self = this;
  var result = [];

  _.forEach(
    ((this.getData().raw.microformats || {}).items || []),
    function (item) {
      _.values(self.interactionMapping).concat(['category']).forEach(function (property) {
        result = result.concat(mfTools.getUValues(item, property));
      });
    }
  );

  return _.uniq(result);
};

Entry.prototype.ping = function (source) {
  var self = this;

  // TODO: Throttle update pings so that a ping happens about 15s after the last update to a source – to give the comment tree a chance to be collected

  this.getWebMentionEndpoints().forEach(function (endpoint) {
    if (!urlTools.isHttpUrl.test(endpoint.href || '')) { return; }

    // TODO: Don't check robots.txt for this one?
    self.requestBroker.add('webmention', endpoint.href, {
      source: source,
      target: self.source
    });
  });
};

Entry.prototype.pingMentions = function () {
  var self = this;

  _.forEach(this._extractInteractions(), function (entryUrl) {
    self.requestBroker.add('metadata', entryUrl, {
      webmention: self.source
    });
  });
};

Entry.prototype.findSalmentionTargets = function () {
  var self = this;

  this.getAllSalmentionTargets().then(function (targets) {
    targets.forEach(function (url) {
      self.requestBroker.add('metadata', url, {
        salmentionUpdate: true
      });
    });
  });
};

Entry.prototype._fetchComments = function () {
  var self = this;
  var normalizedSource = this.normalizedSource;

  this.responses.forEach(function (url) {
    self.requestBroker.add('metadata', url, {
      responsesFor: normalizedSource
    });
  });

  this.comments.forEach(function (url) {
    self.requestBroker.add('metadata', url, {
      commentOf: normalizedSource
    });
  });
};

Entry.prototype.save = function () {
  return this._upsert()
    .then(this._updateOrDeleteExistingMentions.bind(this))
    .then(this._insertMention.bind(this))
    // TODO: Make these last things in parallell
    // TODO: Check if updated prior to _notify(), _ping() and maybe _fetchComments() – else we may get stuck in an inf-loop of pinging!
    .then(this._notify.bind(this))
    .then(this._fetchComments.bind(this));
};

module.exports = Entry;
