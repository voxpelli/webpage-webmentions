'use strict';

var urlTools = require('../lib/utils/url-tools');

exports.up = function (knex, Promise) {
  return knex.transaction(function (trx) {
    return trx.schema.table('entries', function (table) {
        table.renameColumn('url', 'normalizedUrl');
      })
      .then(function () {
        return trx.schema.table('entries', function (table) {
          table.string('url');
        });
      })
      .then(function () {
        return trx.from('entries');
      })
      .then(function (entries) {
        var updates = [];

        entries.forEach(function (entry) {
          var update = trx.table('entries')
            .where('normalizedUrl', entry.normalizedUrl)
            .update({
              url: entry.normalizedUrl,
              normalizedUrl: urlTools.normalizeUrl(entry.normalizedUrl),
            });

          updates.push(update);
        });

        return Promise.all(updates);
      });
    })
    .then(function () {
      return knex.raw('ALTER TABLE "entries" ALTER COLUMN "url" SET NOT NULL');
    });
};

exports.down = function (knex) {
  return knex.transaction(function (trx) {
    return trx.schema.table('entries', function (table) {
      table.dropColumn('normalizedUrl');
    })
    .then(function () {
      return trx.raw('ALTER TABLE "entries" ADD UNIQUE ("url")');
    });
  });
};
