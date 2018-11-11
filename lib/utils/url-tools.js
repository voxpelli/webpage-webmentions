// @ts-check
/// <reference types="node" />

'use strict';

const urlModule = require('url');
const isHttpUrl = /^https?:\/\//;
const isWwwHost = /^www\.[^.]+\.[^.]+$/;
const simpleHostnameValidation = /^[\w.-]*\w$/;

/**
 * @param {string} href The URL to normalize
 * @param {object} [options]
 * @param {string} [options.relativeTo] A base URL that the url to normalize may be relative to
 */
const normalizeUrlRaw = function (href, { relativeTo } = {}) {
  if (relativeTo) {
    href = urlModule.resolve(relativeTo, href);
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

  return parsedHref;
};

/**
 * @param {string} href The URL to normalize
 * @param {object} [options]
 * @param {string} [options.relativeTo] A base URL that the url to normalize may be relative to
 * @returns {string}
 */
const normalizeUrl = (href, options) => urlModule.format(normalizeUrlRaw(href, options));

module.exports = {
  isHttpUrl,
  isWwwHost,
  simpleHostnameValidation,
  normalizeUrlRaw,
  normalizeUrl
};
