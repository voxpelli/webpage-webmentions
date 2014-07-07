"use strict";

var url = require('url'),
  isWwwHost = /^www\.[^.]+\.[^.]+$/,
  normalizeUrl;

normalizeUrl = function (href, relativeTo) {
  var parsedHref;

  if (relativeTo) {
    href = url.resolve(relativeTo, href);
  }

  parsedHref = url.parse(href, false, true);

  if (!parsedHref.protocol || parsedHref.protocol === 'https:') {
    parsedHref.protocol = 'http:';
  }

  if (!parsedHref.host || parsedHref.protocol !== 'http:') {
    throw new Error('Invalid URL, should be an absolute one (' + href + ')');
  }

  if (isWwwHost.test(parsedHref.host)) {
    parsedHref.host = parsedHref.host.substr(4);
  }

  if (!parsedHref.pathname || parsedHref.pathname.substr(-1) !== '/') {
    parsedHref.pathname += '/';
  }

  parsedHref.hash = undefined;

  return url.format(parsedHref);
};

module.exports = {
  isWwwHost : isWwwHost,
  normalizeUrl : normalizeUrl
};
