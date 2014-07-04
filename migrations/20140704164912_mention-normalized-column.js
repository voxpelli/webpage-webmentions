'use strict';

var urlTools = require('../lib/utils/url-tools');

exports.up = function(knex, Promise) {
  return knex.transaction(function (trx) {
    return trx.schema.table('mentions', function (table) {
        table.string('normalizedUrl');
      })
      .then(function () {
        return trx.from('mentions').pluck('url');
      })
      .then(function (urls) {
        var updates = [];

        urls.forEach(function (url) {
          var update = trx.table('mentions')
            .where('url', url)
            .update('normalizedUrl', urlTools.normalizeUrl(url));

          updates.push(update);
        });

        return Promise.all(updates);
      });
    })
    .then(function () {
      return knex.raw('ALTER TABLE "mentions" ALTER COLUMN "normalizedUrl" SET NOT NULL');
    });
};

exports.down = function(knex) {
  return knex.schema.table('mentions', function (table) {
    table.dropColumn('normalizedUrl');
  });
};
