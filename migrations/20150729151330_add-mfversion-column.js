'use strict';

exports.up = function (knex) {
  return knex.transaction(function (trx) {
    return trx.schema.table('entries', function (table) {
        table.string('mfversion');
      })
      .then(function () {
        return trx.table('entries').update({ mfversion: '0.2.15' });
      });
  });
};

exports.down = function (knex) {
  return knex.schema.table('entries', function (table) {
    table.dropColumn('mfversion');
  });
};
