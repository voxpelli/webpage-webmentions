"use strict";

var knex = require('../lib/knex'),
  Promise = require('promise'),
  options = require('../lib/config'),
  installSchema = require('../lib/install-schema'),
  tables = [
    'sites',
    'accounts',

    'mentions',
    'entries',

    'failurelog',
    'knex_migrations',
  ];

// Avoid running tests in non-test environments
if (options.env !== 'test') {
  return;
}

module.exports = {
  clearDb : function () {
    var lastDeleted = Promise.resolve(true);

    tables.forEach(function (table) {
      console.log(table);
      lastDeleted = lastDeleted.then(function () {
        return knex.schema.dropTableIfExists(table);
      });
    });

    return lastDeleted;
  },

  setupSchema : function () {
    return installSchema();
  },

  setupSampleData : function () {
    return Promise.all([
      knex('sites').insert({
        aid: 1,
        hostname: 'example.org',
        created: knex.raw('NOW()')
      })
    ]);
  }
};
