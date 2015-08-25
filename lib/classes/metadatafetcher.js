/*jslint node: true */

"use strict";

var util = require('util'),
  EventEmitter = require('events').EventEmitter,
  VError = require('verror'),
  MetaDataParser = require('./metadataparser'),
  Entry = require('./entry'),
  options = require('../config'),
  MetaDataFetcher;

MetaDataFetcher = function () {
  EventEmitter.call(this);

  this.metaDataParser = new MetaDataParser();
};

util.inherits(MetaDataFetcher, EventEmitter);

MetaDataFetcher.prototype.add = function (url, context) {
  var self = this;

  this.metaDataParser.fetch(
    url,
    context,
    { userAgent: options.userAgent },
    function (err, result) {
      if (err) {
        self.emit('error', new VError(err, 'failed to fetch metadata'));
      } else {
        self.emit('metadata', new Entry(result.url, result.data), result.meta);
      }
    }
  );
};

module.exports = MetaDataFetcher;
