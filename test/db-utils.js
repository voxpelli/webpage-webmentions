'use strict';

const knex = require('../lib/knex');
const sampleData = require('../lib/utils/sample-data');
const urlTools = require('../lib/utils/url-tools');
const options = require('../lib/config');
const installSchema = require('../lib/install-schema');
const tables = installSchema.tables;

// Avoid running tests in non-test environments
if (options.env !== 'test') {
  throw new Error('Can only be run in a test environment (when NODE_ENV=test)');
}

module.exports = {
  clearDb: function () {
    var lastDeleted = Promise.resolve(true);

    tables.forEach(function (table) {
      lastDeleted = lastDeleted.then(function () {
        return knex.schema.dropTableIfExists(table);
      });
    });

    return lastDeleted;
  },

  setupSchema: function () {
    return installSchema();
  },

  setupSampleData: function () {
    return Promise.all([
      knex('sites').insert({
        aid: 1,
        hostname: 'example.org',
        created: knex.raw('NOW()')
      }),
      knex('sites').insert({
        aid: 1,
        hostname: 'example.net',
        created: knex.raw('NOW()'),
        salmentions: true
      })
    ]);
  },

  setupSampleMentions: function (count, options) {
    count = count || 10;

    const entries = [];
    const now = Date.now() - count * 1000;

    for (let i = 0; i < count; i++) {
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
        const target = 'http://example.org/path/' + i;
        const normalizedTarget = urlTools.normalizeUrl(target);

        // Let one mention only have the foo path
        if (i !== 9) {
          mentions.push(knex('mentions').insert({
            url: target,
            normalizedUrl: normalizedTarget,
            eid: id[0],
            hostname: 'example.org'
          }));
        }

        // Let four of the entries mention the very same page
        if (i % 3 === 0) {
          mentions.push(knex('mentions').insert({
            url: 'http://example.org/foo/',
            normalizedUrl: 'http://example.org/foo/',
            eid: id[0],
            hostname: 'example.org'
          }));
        }
      });

      return Promise.all(mentions);
    });
  }
};
