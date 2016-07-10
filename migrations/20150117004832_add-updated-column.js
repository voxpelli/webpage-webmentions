'use strict';

exports.up = function (knex, Promise) {
  return knex.transaction(function (trx) {
    return Promise.all([
      trx.schema.table('entries', function (table) {
        table.timestamp('updated', true);
      }),
      trx.schema.table('mentions', function (table) {
        table.timestamp('updated', true);
        table.boolean('removed').notNullable().defaultTo(false);
      })
    ])
      .then(function () {
        return trx.from('entries');
      })
      .then(function (entries) {
        var updates = [];

        entries.forEach(function (entry) {
          var update = trx.table('entries')
            .where('normalizedUrl', entry.normalizedUrl)
            .update({
              updated: entry.fetched
            });

          updates.push(update);
        });

        return Promise.all(updates);
      });
  })
    .then(function () {
      return knex.raw('ALTER TABLE "entries" ALTER COLUMN "updated" SET NOT NULL');
    });
};

exports.down = function (knex, Promise) {
  return knex.transaction(function (trx) {
    return Promise.all([
      trx.schema.table('entries', function (table) {
        table.dropColumn('updated');
      }),
      trx.schema.table('mentions', function (table) {
        table.dropColumn('updated');
        table.dropColumn('removed');
      })
    ]);
  });
};
