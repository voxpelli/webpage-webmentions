// @ts-check
/// <reference types="node" />
/// <reference types="request" />

'use strict';

const options = require('../config');

const request = require('request').defaults({
  jar: false,
  timeout: 5000,
  maxRedirects: 9,
  headers: {
    'User-Agent': options.userAgent
  }
});

module.exports = request;
