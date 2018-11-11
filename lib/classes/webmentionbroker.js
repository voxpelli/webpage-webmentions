// @ts-check
/// <reference types="node" />

'use strict';

const urlModule = require('url');
const knex = require('../knex');
const { normalizeUrl } = require('../utils/url-tools');

class WebMentionBroker {
  constructor (requestBroker) {
    this.requestBroker = requestBroker;
  }
}

/**
 * @param {string} target
 * @returns {Promise<void>}
 */
WebMentionBroker.prototype.isValidTarget = function (target) {
  const normalizedTarget = normalizeUrl(target);
  const targetHost = urlModule.parse(normalizedTarget).hostname;

  return Promise.resolve(knex('sites').first('aid').where('hostname', targetHost)).then(row => {
    if (!row) {
      console.log('Invalid target site:', targetHost);

      // TODO: Replace with a built in error object that actually defines a "status" property
      const err = new Error('Invalid target site');
      // @ts-ignore
      err.status = 400;
      throw (err);
    }
  });
};

/**
 * @param {string} source
 * @param {string} target
 * @param {boolean} sync
 */
WebMentionBroker.prototype.addToQueue = function (source, target, sync) {
  return this.isValidTarget(target)
    .then(() => this.requestBroker.add('metadata', source, { target, sync }));
};

module.exports = WebMentionBroker;
