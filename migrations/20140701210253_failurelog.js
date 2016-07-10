'use strict';

exports.up = function (knex) {
  return knex.schema.createTable('failurelog', function (table) {
    table.increments('id').primary();
    table.string('source_url').notNullable();
    table.string('target_url');
    table.string('source_hostname').notNullable();
    table.string('target_hostname');
    table.integer('reason').notNullable();
    table.integer('encountered').notNullable();
    table.timestamp('created', true).notNullable();
    table.timestamp('updated', true);
    table.json('data');

    table.unique(['source_url', 'target_url', 'reason']);
  });
};

exports.down = function (knex) {
  return knex.schema.dropTable('failurelog');
};
