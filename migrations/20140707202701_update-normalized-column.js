'use strict';

let urlTools = require('../lib/utils/url-tools');

exports.down = exports.up = function (knex, Promise) {
  return knex.transaction(function (trx) {
    return trx.from('mentions').pluck('url').then(function (urls) {
      let updates = [];

      urls.forEach(function (url) {
        let update = trx.table('mentions')
          .where('url', url)
          .update('normalizedUrl', urlTools.normalizeUrl(url));

        updates.push(update);
      });

      return Promise.all(updates);
    });
  });
};
