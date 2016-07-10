'use strict';

exports.up = function (knex, Promise) {
  return Promise.all([
    knex.schema.createTable('polite_hosts', function (table) {
      table.string('hostname').primary();
      table.timestamp('added', true).notNullable().index();
    }),

    knex.schema.createTable('polite_queue', function (table) {
      table.increments('id').primary();
      table.string('url').notNullable();
      table.string('hostname').notNullable();
      table.boolean('noduplicate');
      table.json('messages');
      table.timestamp('added', true).notNullable();
      table.timestamp('updated', true).notNullable();
      table.unique(['url', 'noduplicate']);
    })
  ]);
};

exports.down = function (knex, Promise) {
  return Promise.all([
    knex.schema.dropTable('polite_hosts'),
    knex.schema.dropTable('polite_queue')
  ]);
};
