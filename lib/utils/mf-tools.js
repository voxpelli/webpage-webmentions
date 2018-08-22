'use strict';

const urlTools = require('./url-tools');

const getUValues = function (item, key) {
  if (!item) { return []; }

  if (key) {
    item = (item.properties || {})[key];
    if (!item) { return []; }
  }

  let result = [];

  if (!Array.isArray(item)) {
    item = [item];
  }

  item.forEach(item => {
    let url = item.value || item;

    if (!urlTools.isHttpUrl.test(url)) {
      url = item.properties || {};
      url = url.url;
    }

    if (url) {
      result = (result || []).concat(url);
    }
  });

  if (result) {
    return result.filter(url => urlTools.isHttpUrl.test(url));
  }
};

module.exports = {
  getUValues
};
