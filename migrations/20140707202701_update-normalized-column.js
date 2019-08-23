'use strict';

const urlTools = require('../lib/utils/url-tools');

exports.down = exports.up = function (knex, Promise) {
  return knex.transaction(function (trx) {
    return trx.from('mentions').pluck('url').then(function (urls) {
      const updates = [];

      urls.forEach(function (url) {
        const update = trx.table('mentions')
          .where('url', url)
          .update('normalizedUrl', urlTools.normalizeUrl(url));

        updates.push(update);
      });

      return Promise.all(updates);
    });
  });
};
