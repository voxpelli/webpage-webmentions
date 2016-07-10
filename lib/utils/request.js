'use strict';

var request = require('request'),
  options = require('../config');

request = request.defaults({
  jar: false,
  timeout: 5000,
  maxRedirects: 9,
  headers: {
    'User-Agent': options.userAgent
  }
});

module.exports = request;
