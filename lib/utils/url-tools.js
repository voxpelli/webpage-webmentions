'use strict';

const urlModule = require('url');
const isHttpUrl = /^https?:\/\//;
const isWwwHost = /^www\.[^.]+\.[^.]+$/;
const simpleHostnameValidation = /^[\w.-]*\w$/;

const normalizeUrl = function (href, options) {
  options = options || {};

  if (options.relativeTo) {
    href = urlModule.resolve(options.relativeTo, href);
  }

  let parsedHref = urlModule.parse(href, false, true);

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

  return options.raw ? parsedHref : urlModule.format(parsedHref);
};

module.exports = {
  isHttpUrl,
  isWwwHost,
  simpleHostnameValidation,
  normalizeUrl
};
