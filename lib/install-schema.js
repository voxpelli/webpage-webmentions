'use strict';

const knex = require('./knex');
const options = require('./config');
const tables = [
  'sites',
  'accounts',

  'mentions',
  'entries',

  'failurelog',
  'knex_migrations',

  'polite_hosts',
  'polite_queue'
];

const install = function () {
  return Promise.all([

  // *** Schema definition ***

    knex.schema.createTable('accounts', table => {
      table.increments('id').primary();
      table.string('service').notNullable();
      table.string('external_id').notNullable();
      table.timestamp('created', true).notNullable();
      table.timestamp('lastlogin', true);
      table.string('username');
    }).createTable('sites', table => {
      table.integer('aid').notNullable().references('accounts.id');
      table.string('hostname').primary();
      table.timestamp('created', true).notNullable();
      table.timestamp('lastmention', true);
      table.boolean('salmentions').notNullable().defaultTo(false);
    }),

    knex.schema.createTable('entries', table => {
      table.increments('id').primary();
      table.string('url').notNullable();
      table.string('normalizedUrl').notNullable().unique();
      table.timestamp('published', true).notNullable();
      table.timestamp('fetched', true).notNullable();
      table.timestamp('updated', true).notNullable();
      table.enum('type', [
        'reply',
        'like',
        'repost'
      ]).nullable();
      table.json('data').notNullable();
      table.json('raw');
      table.string('mfversion');
    }).createTable('mentions', table => {
      table.integer('eid').notNullable().references('entries.id');
      table.boolean('interaction').notNullable().defaultTo(false);
      table.string('url').notNullable();
      table.string('normalizedUrl').notNullable();
      table.string('hostname').notNullable();
      table.timestamp('updated', true);
      table.boolean('removed').notNullable().defaultTo(false);
      table.boolean('directTarget').notNullable().defaultTo(false);
    }),

    knex.schema.createTable('failurelog', table => {
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
    }),

    knex.schema.createTable('polite_hosts', table => {
      table.string('hostname').primary();
      table.timestamp('added', true).notNullable().index();
    }),

    knex.schema.createTable('polite_queue', table => {
      table.increments('id').primary();
      table.string('url').notNullable();
      table.string('hostname').notNullable();
      table.boolean('noduplicate');
      table.json('messages');
      table.timestamp('added', true).notNullable();
      table.timestamp('updated', true).notNullable();
      table.unique(['url', 'noduplicate']);
    })

  // *** End of schema definition ***

  ]).then(() => {
    // Ensure that migrations not needed due to new install becomes flagged as already installed

    const migrator = knex.migrate;

    // Own code to tell that the new schema already is up to date
    const setInitialMigrationState = function (config) {
      this.config = this.setConfig(config);
      return this._migrationData()
        .then(result => {
          const migrations = [];
          const migrationTime = new Date();

          result[0].forEach(migration => {
            migrations.push({
              name: migration,
              batch: 0,
              migration_time: migrationTime
            });
          });

          return knex(this.config.tableName).insert(migrations);
        });
    };

    return setInitialMigrationState.call(migrator);
  }).then(() => {
    if (options.env !== 'production') {
      return knex('accounts').insert({
        'service': 'dummy',
        'external_id': 0,
        'created': knex.fn.now()
      });
    }
  });
};

install.tables = tables;

if (require.main !== module) {
  module.exports = install;
} else {
  install()
    .then(() => {
      knex.destroy();

      console.log('Success!');
    })
    .catch(err => {
      knex.destroy();

      console.error('Failed with error:', err);
    });
}
