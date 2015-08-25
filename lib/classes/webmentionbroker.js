/*jslint node: true */

"use strict";

var urlModule = require('url'),
  knex = require('../knex'),
  options = require('../config'),
  urlTools = require('../utils/url-tools'),
  WebMentionBroker;

WebMentionBroker = function (requestBroker) {
  this.requestBroker = requestBroker;
};

WebMentionBroker.prototype.isValidTarget = function (target) {
  var normalizedTarget = urlTools.normalizeUrl(target);
  var targetHost = urlModule.parse(normalizedTarget).hostname;

  return knex('sites').first('aid').where('hostname', targetHost).then(function (row) {
    if (!row) {
      console.log('Invalid target site:', targetHost);

      var err = new Error('Invalid target site');
      err.status = 400;
      throw(err);
    }
  }.bind(this));
};

WebMentionBroker.prototype.addToQueue = function (source, target, sync) {
  var context = {
    target: target,
    sync: sync,
  };

  return this.isValidTarget(target)
    .then(function () {
      if (
        ((options.env === 'development' && !options.dev.throttling) || options.env === 'test') &&
        ['127.0.0.1', 'localhost', 'example.com'].indexOf(urlModule.parse(source).hostname) !== -1
      ) {
        // Disable throttling on async calls in tests and development environments
        this.requestBroker.emit('metadata', source, context);
      } else {
        return this.requestBroker.add('metadata', source, context);
      }
    }.bind(this));
};

module.exports = WebMentionBroker;
