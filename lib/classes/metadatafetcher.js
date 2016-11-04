'use strict';

const util = require('util');
const EventEmitter = require('events').EventEmitter;
const VError = require('verror');
const MetaDataParser = require('@voxpelli/metadataparser').MetaDataParser;
const MetaDataParserMf2 = require('@voxpelli/metadataparser-mf2');
const options = require('../config');

const MetaDataFetcher = function (entryCollection) {
  EventEmitter.call(this);

  this.metaDataParser = MetaDataParserMf2.addToParser(new MetaDataParser());
  this.entryCollection = entryCollection;
};

util.inherits(MetaDataFetcher, EventEmitter);

MetaDataFetcher.prototype.add = function (url, context) {
  this.metaDataParser.fetch(
    url,
    context,
    { userAgent: options.userAgent },
    (err, result) => {
      if (err) {
        this.emit('error', new VError(err, 'failed to fetch metadata'));
      } else {
        this.emit('metadata', this.entryCollection.create(result.url, result.data), result.meta);
      }
    }
  );
};

module.exports = MetaDataFetcher;
