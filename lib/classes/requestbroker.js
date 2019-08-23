// @ts-check
/// <reference types="node" />

'use strict';

const { EventEmitter } = require('events');
const urlModule = require('url');
const FetchPolitely = require('fetch-politely');
const VError = require('verror');
const knex = require('../knex');
const options = require('../config');

// TODO: Load knex and options through the constructor and/or methods instead to make this class more self-contained

class RequestBroker extends EventEmitter {
  constructor () {
    super();

    const politeOptions = {
      throttleDuration: options.throttleSpan,
      userAgent: options.userAgent,
      allowed: false,
      lookup: FetchPolitely.PolitePGLookup,
      lookupOptions: { knex, onlyDeduplicateMessages: true }
    };

    const politeCallback = (err, url, message) => {
      if (err) {
        this.emit('error', new VError(err, 'error occurred while requesting slot'));
      } else {
        this.emit(message.type, url, message.context);
      }
    };

    this.politeThrottle = new FetchPolitely(politeCallback, politeOptions);
  }
}

RequestBroker.prototype.add = function (type, url, context) {
  if (
    ((options.env === 'development' && !options.dev.throttling) || options.env === 'test') &&
    ['127.0.0.1', 'localhost', 'example.com', 'example.org', 'example.net', 'webmention.example.com'].includes(urlModule.parse(url).hostname)
  ) {
    this.emit(type, url, context);
  } else {
    return this.politeThrottle.requestSlot(url, { type, context }, { allowDuplicates: false });
  }
};

RequestBroker.prototype.close = function () {
  this.politeThrottle.close();
};

module.exports = RequestBroker;
