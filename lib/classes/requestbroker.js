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

  const politeOptions = {
    throttleDuration: options.throttleSpan,
    userAgent: options.userAgent,
    allowed: false,
    lookup: FetchPolitely.PolitePGLookup,
    lookupOptions: { knex }
  };

  const politeCallback = (err, url, message) => {
    if (err) {
      this.emit('error', new VError(err, 'error occurred while requesting slot'));
    } else {
      this.emit(message.type, url, message.context);
    }
  };

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
    return this.politeThrottle.requestSlot(url, { type, context });
  }
};

RequestBroker.prototype.close = function () {
  this.politeThrottle.close();
};

module.exports = RequestBroker;
