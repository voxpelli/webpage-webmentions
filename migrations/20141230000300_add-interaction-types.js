'use strict';

const cloneDeep = require('lodash.clonedeep');
const Entry = require('../lib/classes/entry');
const urlTools = require('../lib/utils/url-tools');

exports.up = function (knex, Promise) {
  return knex.transaction(function (trx) {
    return trx.schema.table('entries', function (table) {
      table.enum('type', [
        'reply',
        'like',
        'repost'
      ]).nullable();
    })
      .then(function () {
        return trx.schema.table('mentions', function (table) {
          table.boolean('interaction').notNullable().defaultTo(false);
        });
      })
      .then(function () {
        return trx.from('entries');
      })
      .then(function (entries) {
        let updates = [];

        entries.forEach(function (entry) {
          const entryInstance = new Entry(entry.url, entry.raw);
          const newEntry = entryInstance.getData();
          let entryUpdate, mentionUpdate, data;

          if (!newEntry.type) {
            return;
          }

          data = cloneDeep(entry.data);
          data.interactionType = newEntry.data.interactionType;
          data.interactions = newEntry.data.interactions;

          entryUpdate = trx.table('entries')
            .where('normalizedUrl', entry.normalizedUrl)
            .update({
              type: newEntry.type,
              data
            });

          updates.push(entryUpdate);

          mentionUpdate = trx.table('mentions')
            .where('eid', entry.id)
            .whereIn('normalizedUrl', data.interactions.map(target => urlTools.normalizeUrl(target, { relativeTo: entry.normalizedUrl })))
            .update({ interaction: true });

          updates.push(mentionUpdate);
        });

        return Promise.all(updates);
      });
  });
};

exports.down = function (knex) {
  return knex.schema.table('entries', function (table) {
    table.dropColumn('type');
  }).then(function () {
    return knex.schema.table('mentions', function (table) {
      table.dropColumn('interaction');
    });
  });
};
