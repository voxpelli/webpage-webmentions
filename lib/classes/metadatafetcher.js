/* jslint node: true */

'use strict';

const util = require('util');
const EventEmitter = require('events').EventEmitter;
const VError = require('verror');
const MetaDataParser = require('./metadataparser');
const options = require('../config');

const MetaDataFetcher = function (entryCollection) {
  EventEmitter.call(this);

  this.metaDataParser = new MetaDataParser();
  this.entryCollection = entryCollection;
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
        self.emit('metadata', self.entryCollection.create(result.url, result.data), result.meta);
      }
    }
  );
};

module.exports = MetaDataFetcher;
