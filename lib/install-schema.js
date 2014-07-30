/*jslint node: true, white: true, indent: 2 */

"use strict";

var knex = require('./knex'),
  Promise = require('promise'),
  options = require('./config'),
  install;

install = function() {
  console.log('Creating tables...');
return Promise.all([

  // *** Schema definition ***

  knex.schema.createTable('accounts', function (table) {
    console.log('"accounts" table');

    table.increments('id').primary();
    table.string('service').notNullable();
    table.string('external_id').notNullable();
    table.timestamp('created', true).notNullable();
    table.timestamp('lastlogin', true);
    table.string('username');
  }).createTable('sites', function (table) {
    console.log('"sites" table');

    table.integer('aid').notNullable().references('accounts.id');
    table.string('hostname').primary();
    table.timestamp('created', true).notNullable();
    table.timestamp('lastmention', true);
  }),

  knex.schema.createTable('entries', function (table) {
    console.log('"entries" table');

    table.increments('id').primary();
    table.string('url').notNullable();
    table.string('normalizedUrl').notNullable().unique();
    table.json('data').notNullable();
    table.json('raw');
  }).createTable('mentions', function (table) {
    console.log('"mentions" table');

    table.integer('eid').notNullable().references('entries.id');
    table.string('url').notNullable();
    table.string('normalizedUrl').notNullable();
    table.string('hostname').notNullable();
  }),

  knex.schema.createTable('failurelog', function (table) {
    console.log('"failurelog" table');

    table.increments('id').primary();
    table.string('source_url').notNullable();
    table.string('target_url');
    table.string('source_hostname').notNullable();
    table.string('target_hostname');
    table.integer('cause').notNullable();
    table.integer('failurecount').notNullable();
    table.timestamp('created', true).notNullable();
    table.timestamp('updated', true);
    table.json('data');
  })

  // *** End of schema definition ***

]).then(function () {
  // Ensure that migrations not needed due to new install becomes flagged as already installed

  console.log('initializes migrations table');

  var setInitialMigrationState;

  // This initializes the migrator – taken from Knex main file
  if (!knex.client.Migrator) {
    knex.client.initMigrator();
  }
  var migrator = new knex.client.Migrator(knex);

  // Own code to tell that the new schema already is up to date
  setInitialMigrationState = function (config) {
    this.config = this.setConfig(config);
    return this._migrationData()
      .bind(this)
      .then(function(result) {
        var migrations = [],
          migration_time = new Date();

        result[0].forEach(function (migration) {
          migrations.push({
            name: migration,
            batch: 0,
            migration_time: migration_time
          });
        });

        return knex(this.config.tableName).insert(migrations);
      });
  };

  return setInitialMigrationState.call(migrator);
}).then(function () {
  if (options.env !== 'production') {
    console.log('sets up dummy user');

    return knex('accounts').insert({
      'service': 'dummy',
      'external_id': 0,
      'created': knex.raw('NOW()')
    });
  }
});
};

if (require.main !== module) {
  module.exports = install;
} else {
  install().then(function () {
    knex.destroy();

    console.log('...success!');
  }, function (err) {
    knex.destroy();

    console.error('...failed with error:', err);
  });
}
