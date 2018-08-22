'use strict';

exports.up = function (knex, Promise) {
  return knex.transaction(function (trx) {
    return trx.schema.table('entries', function (table) {
      table.timestamp('published', true);
      table.timestamp('fetched', true);
    })
      .then(function () {
        return trx.from('entries');
      })
      .then(function (entries) {
        let updates = [];

        entries.forEach(function (entry) {
          let published, update;

          published = entry.data.published ? new Date(parseInt(entry.data.published, 10)) : new Date();

          update = trx.table('entries')
            .where('normalizedUrl', entry.normalizedUrl)
            .update({
              published: published,
              fetched: published
            });

          updates.push(update);
        });

        return Promise.all(updates);
      });
  })
    .then(function () {
      return Promise.all([
        knex.raw('ALTER TABLE "entries" ALTER COLUMN "published" SET NOT NULL'),
        knex.raw('ALTER TABLE "entries" ALTER COLUMN "fetched" SET NOT NULL')
      ]);
    });
};

exports.down = function (knex) {
  return knex.schema.table('entries', function (table) {
    table.dropColumn('published');
    table.dropColumn('fetched');
  });
};
