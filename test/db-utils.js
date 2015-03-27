/*jslint node: true */
/* global -Promise */

"use strict";

var knex = require('../lib/knex'),
  Promise = require('promise'),
  sampleData = require('../lib/utils/sample-data'),
  urlTools = require('../lib/utils/url-tools'),
  options = require('../lib/config'),
  installSchema = require('../lib/install-schema'),
  tables = installSchema.tables;

// Avoid running tests in non-test environments
if (options.env !== 'test') {
  return;
}

module.exports = {
  clearDb : function () {
    var lastDeleted = Promise.resolve(true);

    tables.forEach(function (table) {
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

  setupSampleMentions : function (count, options) {
    count = count || 10;

    var entries = [], i, now;

    now = Date.now() - count * 1000;

    for (i = 0; i < count; i++) {
      entries.push(sampleData.mentions(1, options)[0]);
    }

    return Promise.all(entries.map(function (entry, i) {
      var entryUrl = entry.url;

      entry.published = now + i * 1000;
      entry.type = entry.type === 'mention' ? null : entry.type;
      delete entry.url; // Doesn't belong in the database
      delete entry.targets; // Doesn't belong in the database

      // Create expectable metadata
      if (i % 3) {
        entry.name = null;
      }

      return knex('entries').insert({
        url: entryUrl,
        normalizedUrl: urlTools.normalizeUrl(entryUrl),
        published: new Date(entry.published),
        fetched: new Date(entry.published),
        updated: new Date(entry.published),
        type: entry.type,
        data: entry,
        raw: {}
      }, 'id');
    })).then(function (ids) {
      var mentions = [];

      ids.forEach(function (id, i) {
        var target = 'http://example.org/path/' + i,
          normalizedTarget = urlTools.normalizeUrl(target);

        // Let one mention only have the foo path
        if (i !== 9) {
          mentions.push(knex('mentions').insert({
            url : target,
            normalizedUrl : normalizedTarget,
            eid : id[0],
            hostname : 'example.org'
          }));
        }

        // Let four of the entries mention the very same page
        if (i % 3 === 0) {
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
