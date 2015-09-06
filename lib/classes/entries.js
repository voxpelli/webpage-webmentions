/*jslint node: true */

"use strict";

var assert = require('assert'),
  url = require('url'),
  _ = require('lodash'),
  LRU = require('lru-cache'),
  urlTools = require('../utils/url-tools'),
  Entry = require('./entry'),
  Entries;

Entries = function (options) {
  options = options || {};

  assert(options.knex, 'knex option required');

  this.knex = options.knex;
  this.requestBroker = options.requestBroker;

  this.mentionsCache = LRU({
    max: options.mentionsCacheLimit || 10000,
    length: function (n) {
      return n.length;
    }
  });
};

Entries.prototype._buildMentionTree = function (mentions) {
  var mentionsById = {}, result = [];

  mentions.forEach(function (mention) {
    mentionsById[mention.id] = mention;
  });

  mentions.forEach(function (mention) {
    mention.parents.forEach(function (parentId) {
      var existing = [mention], circular = false;

      var check = function (mention) {
        return mention.id === parentId;
      };

      if (parentId !== 0) {
        while (existing.length) {
          if (existing.some(check)) {
            circular = true;
            break;
          }
          existing = existing.reduce(function (submentions, mention) {
            return submentions.concat(mention.mentions || []);
          }, []);
        }

        if (!circular) {
          mentionsById[parentId].mentions = mentionsById[parentId].mentions || [];
          mentionsById[parentId].mentions.push(mention);
        }
      }
    });
  });

  mentions.forEach(function (mention) {
    if (mention.parents.indexOf(0) !== -1) {
      result.push(mention);
    }

    delete mention.id;
    delete mention.parents;
  });

  return result;
};

Entries.prototype._resolveDerivedData = function (data) {
  var matchingInteractionTargets;

  if (data.type !== 'mention') {
    matchingInteractionTargets = _.intersection(
      _.map(data.targets, urlTools.normalizeUrl),
      _.map(data.interactions, urlTools.normalizeUrl)
    );

    data.interactionTarget = (matchingInteractionTargets.length !== 0);
  }

  return data;
};

Entries.prototype._distillMention = function (row) {
  if (!row || !row.data) {
    return false;
  }

  var data = _.pick(row.data, ['url', 'name', 'published', 'summary', 'author', 'interactionType', 'interactions']);

  data.author = _.pick(data.author || {}, ['name', 'photo', 'url']);

  data.url = data.url || row.url;
  data.targets = row.targets || [];
  data.type = row.type || data.interactionType || 'mention';
  data.interactions = data.interactions || [];
  data.parents = row.parents;
  data.id = row.id;

  if (row.removedTargets || row.removedTargets === null) {
    data.removedTargets = row.removedTargets || [];
  }

  data = this._resolveDerivedData(data);

  delete data.interactionType;

  return data;
};

Entries.prototype._distillTargets = function (mention, target) {
  var isTarget;

  isTarget = function (checkTarget) {
    var result = false;
    var checkNormalized = urlTools.normalizeUrl(checkTarget);
    var checkSite = url.parse(checkNormalized).hostname;

    if (!_.isEmpty(target.url)) {
      result = [].concat(target.url).some(function (targetUrl) {
        return checkNormalized === urlTools.normalizeUrl(targetUrl);
      });
    }
    if (!result && !_.isEmpty(target.site)) {
      result = [].concat(target.site).some(function (targetSite) {
        return checkSite === targetSite;
      });
    }
    if (!result && !_.isEmpty(target.path)) {
      result = [].concat(target.path).some(function (targetPath) {
        return checkNormalized.indexOf(targetPath) === 0;
      });
    }

    return result;
  };

  mention = _.cloneDeep(mention);
  mention.targets = _.filter(mention.targets, isTarget);
  mention.removedTargets = _.filter(mention.removedTargets, isTarget);

  mention = this._resolveDerivedData(mention);

  return mention;
};

Entries.prototype._getTargetQuery = function (target, options) {
  var knex = this.knex;
  var query = knex('mentions').distinct('eid');

  query = query.where(function() {
    if (!_.isEmpty(target.url)) {
      //TODO: Validate URL?
      target.url = _.isArray(target.url) ? target.url : [target.url];
      this.orWhereIn('mentions.normalizedUrl', _.map(target.url, urlTools.normalizeUrl));
    }
    if (!_.isEmpty(target.site)) {
      target.site = _.isArray(target.site) ? target.site : [target.site];
      this.orWhereIn('mentions.hostname', _.map(target.site, function (hostname) {
        if (!urlTools.simpleHostnameValidation.test(hostname)) {
          return undefined;
        }
        try {
          return urlTools.normalizeUrl('http://' + hostname + '/', { raw: true }).hostname;
        } catch (e) {
          return undefined;
        }
      }));
    }
    if (!_.isEmpty(target.path)) {
      target.path = _.isArray(target.path) ? target.path : [target.path];
      _.each(target.path, function (path) {
        this.orWhere('normalizedUrl', 'like', urlTools.normalizeUrl(path).replace(/\\/g, '').replace(/[%_]/g, '\\%') + '%');
      }.bind(this));
    }
  });

  query = query.where('mentions.removed', false);

  if (options.interactions === true) {
    query = query.where('interaction', true);
  }

  return query;
};

Entries.prototype.get = function (entryId) {
  var knex = this.knex;

  var targets = knex('mentions').as('targets')
    .select(knex.raw('array_agg(mentions.url)'))
    .whereRaw('mentions.eid = entries.id')
    .where('removed', false);

  var removed = knex('mentions').as('removedTargets')
    .select(knex.raw('array_agg(mentions.url)'))
    .whereRaw('mentions.eid = entries.id')
    .where('removed', true);

  var query = knex('entries')
    .first(
      'entries.url as url',
      'data',
      'type',
      targets,
      removed
    )
    .where('id', entryId);

  return query.then(this._distillMention.bind(this));
};

Entries.prototype.queryByTarget = function (target, options) {
  var knex = this.knex;
  var self = this;

  target = target || {};
  options = options || {};

  if (!_.isPlainObject(target)) {
    target = { url: target };
  }

  if (target.example !== undefined) {
    return Promise.resolve(require('../utils/sample-data').mentions(14, options)).then(function (mentions) {
      return _.map(mentions, function (example) {
        return self._distillMention({
          data : example,
          type : example.type,
          targets : example.targets,
        });
      });
    }).catch(function (err) {
      console.warn(err);
      console.log(err.stack);
      return [];
    });
  } else if (!target.url && !target.site && !target.path) {
    return Promise.resolve([]);
  }

  var fullQuery,
    entryQuery = knex('entries'),
    query = this._getTargetQuery(target, options),
    interactionTypes = ['like', 'repost'];

  entryQuery = entryQuery.select(
      'entries.url as url',
      'data',
      'type',
      knex.raw('array_agg(allmentions.url) as targets'),
      knex.raw('array_agg(allmentions.parent) as parents'),
      'id'
    )
    .innerJoin('allmentions', 'entries.id', 'allmentions.eid')
    .groupBy('entries.id')
    .orderBy('published', options.sort === 'desc' ? 'desc' : 'asc');

  if (options.interactions === true) {
    entryQuery = entryQuery.whereIn('type', interactionTypes);
  } else if (options.interactions === false) {
    entryQuery = entryQuery.where(function() {
      this.whereNotIn('type', interactionTypes);
      this.orWhereNull('type');
    });
  }

  query = query.select(knex.raw('0'), 'normalizedUrl', 'url').union(function() {
    this.select('mentions.eid', 'allmentions.eid', 'mentions.normalizedUrl', 'mentions.url')
      .from('mentions')
      .innerJoin('entries', 'entries.normalizedUrl', 'mentions.normalizedUrl')
      .innerJoin('allmentions', 'entries.id', 'allmentions.eid')
      .where('mentions.removed', false);
  });

  fullQuery = knex.raw('WITH RECURSIVE "allmentions"("eid", "parent", "normalizedUrl", "url") AS (' + query +  ') ' + entryQuery + '');

  return fullQuery
    .then(function (result) {
      return result.rows
        .map(self._distillMention.bind(self))
        .map(function (row) {
          return options.distillTargets ? self._distillTargets(row, target) : row;
        });
    })
    .then(self._buildMentionTree.bind(self))
    .then(
      function (rows) {
        self.mentionsCache.set(target, rows);
      },
      function (err) {
        console.warn(err);
        console.log(err.stack);
      }
    )
    .then(function () {
      return _.cloneDeep(self.mentionsCache.get(target) || []);
    });
};

Entries.prototype.create = function (entryUrl, data) {
  return new Entry(entryUrl, data, {
    requestBroker: this.requestBroker,
    entryCollection: this,
  });
};

module.exports = Entries;
