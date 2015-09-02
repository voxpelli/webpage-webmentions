'use strict';

exports.up = function (knex) {
  return knex.transaction(function (trx) {
    return trx.schema.table('mentions', function (table) {
        table.boolean('directTarget').notNullable().defaultTo(false);
      })
      .then(function () {
        return trx.table('mentions').update({ directTarget: true });
      });
  });
};

exports.down = function (knex) {
  return knex.schema.table('mentions', function (table) {
    table.dropColumn('directTarget');
  });
};
