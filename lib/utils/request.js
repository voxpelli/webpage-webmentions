"use strict";

var request = require('request'),
  options = require('../config');

request = request.defaults({
  jar: false,
  timeout: 5000,
  maxRedirects : 9,
  headers: {
    'User-Agent' : 'A-WebMention-Endpoint/' + options.version + ' (https://github.com/voxpelli/webpage-webmentions)'
  }
});

module.exports = request;