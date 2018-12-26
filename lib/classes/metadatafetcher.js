// @ts-check
/// <reference types="node" />

'use strict';

const { EventEmitter } = require('events');
const VError = require('verror');
const MetaDataParser = require('@voxpelli/metadataparser').MetaDataParser;
const MetaDataParserMf2 = require('@voxpelli/metadataparser-mf2');
const options = require('../config');

class MetaDataFetcher extends EventEmitter {
  constructor (entryCollection) {
    super();

    this.metaDataParser = MetaDataParserMf2.addToParser(new MetaDataParser());
    this.entryCollection = entryCollection;
  }
}

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
