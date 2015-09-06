'use strict';

exports.up = function (knex) {
  return knex.transaction(function (trx) {
    return trx.schema.table('sites', function (table) {
      table.boolean('salmentions').notNullable().defaultTo(false);
    });
  });
};

exports.down = function (knex) {
  return knex.schema.table('sites', function (table) {
    table.dropColumn('salmentions');
  });
};
