'use strict';

var _ = require('lodash'),
  urlTools = require('../lib/utils/url-tools');

exports.up = function (knex, Promise) {
  return knex.from('entries').then(function (entries) {
    return Promise.all(_.map(entries, function (entry) {
      var data = entry.data;

      if (!urlTools.isHttpUrl.test(data.url)) {
        data.url = entry.url;
      }
      if (!urlTools.isHttpUrl.test(data.author.url)) {
        data.author.url = null;
      }

      return knex.table('entries')
        .where('id', entry.id)
        .update('data', data);
    }));
  });
};

exports.down = function () {};
