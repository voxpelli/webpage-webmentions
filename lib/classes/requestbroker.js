/* jslint node: true */

'use strict';

const util = require('util');
const EventEmitter = require('events').EventEmitter;
const urlModule = require('url');
const FetchPolitely = require('fetch-politely');
const VError = require('verror');
const knex = require('../knex');
const options = require('../config');

// TODO: Load knex and options through the constructor and/or methods instead to make this class more self-contained

const RequestBroker = function () {
  EventEmitter.call(this);

  var politeOptions = {
    throttleDuration: options.throttleSpan,
    userAgent: options.userAgent,
    allowed: false,
    lookup: FetchPolitely.PolitePGLookup,
    lookupOptions: {
      knex: knex
    }
  };

  var politeCallback = (function (err, url, message) {
    if (err) {
      this.emit('error', new VError(err, 'error occurred while requesting slot'));
    } else {
      this.emit(message.type, url, message.context);
    }
  }.bind(this));

  this.politeThrottle = new FetchPolitely(politeCallback, politeOptions);
};

util.inherits(RequestBroker, EventEmitter);

RequestBroker.prototype.add = function (type, url, context) {
  if (
    ((options.env === 'development' && !options.dev.throttling) || options.env === 'test') &&
    ['127.0.0.1', 'localhost', 'example.com', 'example.org', 'example.net', 'webmention.example.com'].indexOf(urlModule.parse(url).hostname) !== -1
  ) {
    this.emit(type, url, context);
  } else {
    return this.politeThrottle.requestSlot(url, {
      type: type,
      context: context
    });
  }
};

RequestBroker.prototype.close = function () {
  this.politeThrottle.close();
};

module.exports = RequestBroker;
