"use strict";

var knex = require('../lib/knex'),
  Promise = require('promise'),
  sampleData = require('../lib/utils/sample-data'),
  urlTools = require('../lib/utils/url-tools'),
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
  },

  setupSampleMentions : function (count) {
    count = count || 10;

    var entries = sampleData.mentions(count);

    entries.forEach(function (entry, i) {
      entries[i] = knex('entries').insert({
        url: entry.url,
        normalizedUrl: urlTools.normalizeUrl(entry.url),
        data: entry,
        raw: {}
      }, 'id');

      delete entry.url;
    });

    return Promise.all(entries).then(function (ids) {
      var mentions = [];

      ids.forEach(function (id) {
        var target = 'http://example.org/path/' + id[0],
          normalizedTarget = urlTools.normalizeUrl(target);

        // Let one mention only have the foo path
        if (id[0] !== 10) {
          mentions.push(knex('mentions').insert({
            url : target,
            normalizedUrl : normalizedTarget,
            eid : id[0],
            hostname : 'example.org'
          }));
        }

        // Let four of the entries mention the very same page
        if (id % 3 === 1) {
          mentions.push(knex('mentions').insert({
            url : 'http://example.org/foo/',
            normalizedUrl : 'http://example.org/foo/',
            eid : id[0],
            hostname : 'example.org'
          }));
        }
      });

      return Promise.all(mentions);
    });
  }
};
