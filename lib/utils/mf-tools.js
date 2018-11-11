// @ts-check
/// <reference types="node" />

'use strict';

const { isHttpUrl } = require('./url-tools');

/**
 * @typedef MicroformatComplexItem
 * @property {Object<string,MicroformatItem[]>} [properties]
 * @property {string[]} [type]
 * @property {string} [value]
 * @property {string} [html]
 */

/**
 * @typedef {string} MicroformatSimpleItem
 */

/**
 * @typedef {MicroformatSimpleItem|MicroformatComplexItem} MicroformatItem
 */

/**
 * Gets link values from a microformat object
 *
 * Checking the different ways such a value can be defined
 *
 * @param {MicroformatItem} [item]
 * @param {string} [key]
 * @returns {string[]}
 */
const getUValues = function (item, key) {
  if (!item) { return []; }

  /** @type {MicroformatItem[]} */
  let derivedItems;

  if (key) {
    if (typeof item === 'string') { return []; }

    derivedItems = (item.properties || {})[key];

    if (!derivedItems) { return []; }
  }

  let result = [];

  if (!Array.isArray(derivedItems)) {
    derivedItems = [item];
  }

  derivedItems.forEach(data => {
    let url;

    if (typeof data === 'string') {
      url = data;
    } else {
      url = data.value;

      if (!isHttpUrl.test(url)) {
        const complexProperty = ((data.properties || {}).url || [])[0];
        url = typeof complexProperty === 'string' ? complexProperty : undefined;
      }
    }

    if (url) {
      result = (result || []).concat(url);
    }
  });

  if (result) {
    return result.filter(url => isHttpUrl.test(url));
  }
};

module.exports = {
  getUValues
};
