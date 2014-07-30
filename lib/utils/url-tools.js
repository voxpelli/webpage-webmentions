"use strict";

var url = require('url'),
  isWwwHost = /^www\.[^.]+\.[^.]+$/,
  simpleHostnameValidation = /^[\w\.-]*\w$/,
  normalizeUrl;

normalizeUrl = function (href, options) {
  var parsedHref;

  options = options || {};

  if (options.relativeTo) {
    href = url.resolve(options.relativeTo, href);
  }

  parsedHref = url.parse(href, false, true);

  if (!parsedHref.protocol || parsedHref.protocol === 'https:') {
    parsedHref.protocol = 'http:';
  }

  if (!parsedHref.hostname || parsedHref.protocol !== 'http:') {
    throw new Error('Invalid URL, should be an absolute one (' + href + ')');
  }

  if (isWwwHost.test(parsedHref.hostname)) {
    parsedHref.hostname = parsedHref.hostname.substr(4);
    parsedHref.host = parsedHref.hostname + (parsedHref.port && parsedHref.port !== '80' ? ':' + parsedHref.port : '');
  }

  if (!parsedHref.pathname || parsedHref.pathname.substr(-1) !== '/') {
    parsedHref.pathname += '/';
  }

  parsedHref.pathname = parsedHref.pathname.replace(/\/{2,}/g, '/');

  parsedHref.hash = undefined;

  return options.raw ? parsedHref : url.format(parsedHref);
};

module.exports = {
  isWwwHost : isWwwHost,
  normalizeUrl : normalizeUrl,
  simpleHostnameValidation : simpleHostnameValidation
};
