'use strict';

const urlModule = require('url');
const knex = require('../knex');
const urlTools = require('../utils/url-tools');

const WebMentionBroker = function (requestBroker) {
  this.requestBroker = requestBroker;
};

WebMentionBroker.prototype.isValidTarget = function (target) {
  const normalizedTarget = urlTools.normalizeUrl(target);
  const targetHost = urlModule.parse(normalizedTarget).hostname;

  return knex('sites').first('aid').where('hostname', targetHost).then(row => {
    if (!row) {
      console.log('Invalid target site:', targetHost);

      const err = new Error('Invalid target site');
      err.status = 400;
      throw (err);
    }
  });
};

WebMentionBroker.prototype.addToQueue = function (source, target, sync) {
  return this.isValidTarget(target)
    .then(() => this.requestBroker.add('metadata', source, { target, sync }));
};

module.exports = WebMentionBroker;
