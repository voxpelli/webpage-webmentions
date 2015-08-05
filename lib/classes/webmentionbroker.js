/*jslint node: true */

"use strict";

var urlModule = require('url'),
  FetchPolitely = require('fetch-politely'),
  knex = require('../knex'),
  options = require('../config'),
  WebMentionPing = require('./webmentionping'),
  urlTools = require('../utils/url-tools'),
  WebMentionBroker;

WebMentionBroker = function () {
  var politeOptions = {
    throttleDuration: options.throttleSpan,
    userAgent: options.userAgent,
    allowed: false,
    lookup: FetchPolitely.PolitePGLookup,
    lookupOptions: {
      knex: knex
    },
    //TODO: Move the fetching completely into Fetch Politely?
    // returnContent: true,
  };

  var politeCallback = function (err, url, message) {
    if (err) {
      return console.error(err, err.stack);
    } else if (!message.target) {
      return console.error('No target found!');
    }

    this.processMention(url, message.target)
      .catch(function (err) {
        console.error(err, err.stack);
      });
  };

  this.politeThrottle = new FetchPolitely(politeCallback.bind(this), politeOptions);
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
  return this.isValidTarget(target)
    .then(function () {
      if (sync && (options.env === 'development' || options.env === 'test')) {
        // Enable debuggable sync calls in development environments
        return this.processMention(source, target).then(function () {
          return 'sync';
        });
      } else if (
        ((options.env === 'development' && !options.dev.throttling) || options.env === 'test') &&
        ['127.0.0.1', 'localhost', 'example.com'].indexOf(urlModule.parse(source).hostname) !== -1
      ) {
        // Disable throttling on async calls in tests and development environments
        this.processMention(source, target);
        return Promise.resolve();
      }

      return this.politeThrottle.requestSlot(
        source,
        { target: target },
        { allowDuplicates: false }
      );
    }.bind(this));
};

WebMentionBroker.prototype.processMention = function (source, target) {
  console.log('Fetching!', source, target);

  var ping = new WebMentionPing(source, target);

  return ping.fetchSourcePage()
    .then(ping.parseSourcePage.bind(ping))
    .then(ping.createMention.bind(ping))
    .then(ping.saveMention.bind(ping));
};

WebMentionBroker.prototype.close = function () {
  this.politeThrottle.close();
};

module.exports = WebMentionBroker;
