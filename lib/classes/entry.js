// @ts-check
/// <reference types="node" />

'use strict';

const urlModule = require('url');
const uniq = require('lodash.uniq');
const isEmpty = require('lodash.isempty');
const omit = require('lodash.omit');
const _values = require('lodash.values');
const moment = require('moment');
const VError = require('verror');

const { getUValues } = require('../utils/mf-tools');
const { normalizeUrl, isHttpUrl } = require('../utils/url-tools');

/**
 * @typedef EntryRawMetadata
 * @property {{ items?: {properties: Object<string,any>}[] }} [microformats]
 * @property {{ version?: string, microformatsVersion?: string }} [microformatsVersion]
 * @property {string[]} [hrefs]
 * @property {*} [links]
 */

/** @typedef {'reply'|'like'|'repost'} EntryInteraction */

/**
 * @typedef EntryRowData
 * @property {string} url
 * @property {string} [name]
 * @property {number} [published]
 * @property {string} [summary]
 * @property {object} [author]
 * @property {object} [author.name]
 * @property {string} [author.photo]
 * @property {string} [author.url]
 * @property {EntryInteraction} [interactionType]
 * @property {string[]} interactions
 */

/**
 * @typedef EntryData
 * @property {string} url
 * @property {string} normalizedUrl
 * @property {Date} published
 * @property {Date} fetched
 * @property {Date} updated
 * @property {EntryInteraction} [type]
 * @property {EntryRowData} data
 * @property {EntryRawMetadata} raw
 * @property {string} mfversion
 */

class Entry {
  /**
   * @param {string} source The non-normalized source URL
   * @param {EntryRawMetadata} metadata The parsed metadata
   * @param {object} [options]
   * @param {import('knex')} [options.knex]
   * @param {object} [options.requestBroker]
   * @param {object} [options.entryCollection]
   */
  constructor (source, metadata, options = {}) {
    this.knex = options.knex;
    this.requestBroker = options.requestBroker;
    // this.entryCollection = options.entryCollection;

    this.source = source;

    this.normalizedSource = normalizeUrl(source);
    this.sourceHost = urlModule.parse(this.normalizedSource).hostname;
    this.sourceBase = this.source;

    this.newTargets = {};

    this.setData(metadata);
  }
}

Entry.prototype.interactionMapping = {
  'reply': 'in-reply-to',
  'like': 'like-of',
  'repost': 'repost-of'
};

/** @returns {string[]} */
Entry.prototype.getHrefs = function () {
  if (!this.hrefs) {
    this.hrefs = (this.data.raw.hrefs || [])
      .map(url => {
        try {
          return normalizeUrl(url);
        } catch (err) {}
      })
      .filter(url => !!url);
  }
  return this.hrefs;
};

/** @returns {boolean} */
Entry.prototype.hasTarget = function (target) {
  return this.getHrefs().indexOf(normalizeUrl(target)) !== -1;
};

/**
 * @param {string} target
 * @param {boolean} [direct]
 * @returns {boolean} Whether the target was a valid one that could be added or not
 */
Entry.prototype.addTarget = function (target, direct) {
  if (!this.hasTarget(target)) { return false; }

  this.newTargets[normalizeUrl(target)] = {
    target,
    direct: direct || false
  };

  return true;
};

/** @returns {EntryData} */
Entry.prototype.getData = function () {
  return this.data;
};

/**
 * @param {EntryRawMetadata} metadata
 * @returns {void}
 */
Entry.prototype.setData = function (metadata) {
  if (!metadata) {
    console.warn('Trying to setData() for page from', this.sourceHost, 'with empty metadata.');
    metadata = {};
  }

  const data = metadata.microformats || {};
  const versions = metadata.microformatsVersion || {};
  const entry = {};
  const now = Date.now();

  if ((data.items || []).length) {
    const item = data.items[0].properties;
    const author = (item.author ? item.author[0].properties : {}) || {};
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

    this.responses = (item.responses || []).map(responses => {
      const url = responses.value || responses;
      if (url && isHttpUrl.test(url)) {
        return url;
      }
    }).filter(item => !!item);

    this.comments = (item.comment || []).map(comment => (getUValues(comment) || [])[0]).filter(item => !!item);

    // Find the kind of interaction this is and what the interaction targets are. Stop at first find.
    Object.keys(this.interactionMapping).map(type => {
      const key = this.interactionMapping[type];
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
      entry.interactions = uniq(entry.interactions.map(target => {
        const targetType = typeof target;
        if (targetType === 'object' && target.properties.url) {
          target = target.properties.url[0];
        } else if (targetType !== 'string') {
          return null;
        }
        return urlModule.resolve(this.sourceBase, target);
      })).filter(item => !!item);
    }

    // XSS protection, stop non-HTTP protocols
    if (!isHttpUrl.test(entry.url)) {
      entry.url = this.source;
    }
    if (!isHttpUrl.test(entry.author.url)) {
      entry.author.url = null;
    }
  } else {
    entry.published = now;
  }

  /** @type {EntryData} */
  const assembledData = {
    url: this.source,
    normalizedUrl: this.normalizedSource,
    published: new Date(entry.published),
    fetched: new Date(now),
    updated: new Date(now),
    type: entry.interactionType || null,
    data: entry,
    raw: metadata,
    mfversion: ['mf2', versions.version, versions.microformatsVersion].join('::')
  };

  this.data = assembledData;
};

/**
 * @param {EntryData} entry
 * @param {string} normalizedTarget
 * @returns {boolean}
 */
Entry.prototype._isInteractionTarget = function (entry, normalizedTarget) {
  return !!entry.type && entry.data.interactions.some(target =>
    normalizeUrl(target, { relativeTo: this.sourceBase }) === normalizedTarget
  );
};

/**
 * @returns {Promise<boolean>}
 */
Entry.prototype._upsert = function () {
  const knex = this.knex;
  const entry = this.getData();

  let updated = false;

  const updateMention = () =>
    knex.table('entries')
      .where('normalizedUrl', entry.normalizedUrl)
      // .whereNot('data', entry.data)
      .update({
        updated: entry.fetched,
        type: entry.type,
        data: entry.data,
        raw: entry.raw,
        mfversion: entry.mfversion
      }, 'id').then(id => {
        if (id[0]) {
          updated = true;
        }
        return id;
      });

  return Promise.resolve(updateMention())
    .then(id => id.length ? id : knex.table('entries').insert(entry, 'id'))
    .catch(err => {
      // Unique constraint error
      if (err.code === '23505') {
        return updateMention();
      } else {
        throw err;
      }
    })
    .then(id => {
      this.id = id[0];
      return updated;
    })
    .catch(err => Promise.reject(new VError(err, 'Mention upsert failed')));
};

/**
 * @param {boolean} updated
 * @returns {Promise<void>}
 */
Entry.prototype._updateOrDeleteExistingMentions = function (updated) {
  // If new entry, then no existing mentions exists
  if (!updated) {
    return Promise.resolve();
  }

  const knex = this.knex;
  const id = this.id;
  const entry = this.getData();

  // TODO: Add test for entry updates and mention updates / removal
  return Promise.resolve(knex.table('mentions').where('eid', id).select().then(existingMentions => {
    const updates = existingMentions.map(existingMention => {
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

      update = omit(update, (value, property) => existingMention[property] === value);

      if (isEmpty(update)) {
        return;
      }

      update.updated = entry.fetched;

      return knex.table('mentions')
        .where('eid', id)
        .where('normalizedUrl', existingMention.normalizedUrl)
        .update(update);
    });

    return Promise.all(updates)
      .then(() => {});
  }));
};

/**
 * @returns {Promise<void>}
 */
Entry.prototype._insertMention = function () {
  const knex = this.knex;
  const id = this.id;
  const entry = this.getData();

  return Promise.all(Object.keys(this.newTargets).map(normalizedTarget => {
    const target = this.newTargets[normalizedTarget];
    const targetHost = urlModule.parse(normalizedTarget).hostname;

    return Promise.all([
      knex.table('sites').update('lastmention', knex.fn.now()).where('hostname', targetHost),
      knex.table('mentions').insert({
        url: target.target,
        normalizedUrl: normalizedTarget,
        interaction: this._isInteractionTarget(entry, normalizedTarget),
        eid: id,
        hostname: targetHost,
        directTarget: target.direct
      })
        .catch(err => {
          if (err.code === '23505') {
          // Unique constraint error, ignore
          } else {
            throw err;
          }
        })
    ]);
  }))
    .then(() => {});
};

/**
 * @returns {Promise<void>}
 */
Entry.prototype._notify = function () {
  return Promise.resolve(this.knex.raw("NOTIFY mentions, '" + JSON.stringify({ eid: this.id }) + "'"))
    .then(() => {})
    .catch(() => {});
};

// TODO: Move these new methods to better locations in the file
Entry.prototype.getWebMentionEndpoints = function () {
  return uniq((this.getData().raw.links || {}).webmention || []);
};

/**
 * @returns {Promise<string[]>}
 */
Entry.prototype.getAllSalmentionTargets = function () {
  const knex = this.knex;

  // TODO: Move "directTarget" resolve to instead check of "hostname" exists in "sites" – if it does, then it's a direct target

  const query = knex('mentions')
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

  const filterQuery = knex('allmentions')
    .distinct('allmentions.url')
    .innerJoin('sites', 'sites.hostname', 'allmentions.hostname')
    .where('allmentions.directTarget', true)
    .where('sites.salmentions', true);

  return Promise.resolve(knex.raw('WITH RECURSIVE "allmentions"("eid", "parentId", "normalizedUrl", "url", "directTarget", "hostname") AS (' + query + ') ' + filterQuery + ''))
    .then(result => result.rows.map(row => row.url));
};

/**
 *
 */
Entry.prototype._extractInteractions = function () {
  let result = [];

  ((this.getData().raw.microformats || {}).items || []).forEach(item => {
    _values(this.interactionMapping).concat(['category']).forEach(property => {
      result = result.concat(getUValues(item, property));
    });
  });

  return uniq(result);
};

Entry.prototype.ping = function (source) {
  // TODO: Throttle update pings so that a ping happens about 15s after the last update to a source – to give the comment tree a chance to be collected

  this.getWebMentionEndpoints().forEach(endpoint => {
    if (!isHttpUrl.test(endpoint.href || '')) { return; }

    // TODO: Don't check robots.txt for this one?
    this.requestBroker.add('webmention', endpoint.href, {
      source,
      target: this.source
    });
  });
};

Entry.prototype.pingMentions = function () {
  this._extractInteractions().forEach(entryUrl => {
    this.requestBroker.add('metadata', entryUrl, {
      webmention: this.source
    });
  });
};

Entry.prototype.findSalmentionTargets = function () {
  this.getAllSalmentionTargets().then(targets => {
    targets.forEach(url => {
      this.requestBroker.add('metadata', url, {
        salmentionUpdate: true
      });
    });
  }).catch(err => { console.error('Encountered an error: ' + err.stack); });
};

Entry.prototype._fetchComments = function ({ fetchChain }) {
  fetchChain = (fetchChain || []).concat(this.normalizedSource);

  this.responses.forEach(url => {
    if (!fetchChain.includes(normalizeUrl(url))) {
      this.requestBroker.add('metadata', url, {
        fetchChain,
        responsesFor: this.normalizedSource
      });
    } else {
      console.log('Page already in fetch chain:', this.source);
    }
  });

  this.comments.forEach(url => {
    if (!fetchChain.includes(normalizeUrl(url))) {
      this.requestBroker.add('metadata', url, {
        fetchChain,
        commentOf: this.normalizedSource
      });
    } else {
      console.log('Page already in fetch chain:', this.source);
    }
  });
};

Entry.prototype.save = function (context) {
  context = context || {};

  return this._upsert()
    .then(updated => this._updateOrDeleteExistingMentions(updated))
    .then(() => this._insertMention())
    // TODO: Make these last things in parallell
    // TODO: Check if updated prior to _notify(), _ping() and maybe _fetchComments() – else we may get stuck in an inf-loop of pinging!
    .then(() => this._notify())
    .then(() => this._fetchComments(context));
};

module.exports = Entry;
