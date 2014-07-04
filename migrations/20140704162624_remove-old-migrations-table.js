'use strict';

exports.up = function(knex) {
  return knex.schema.dropTableIfExists('migrations');
};

exports.down = function() {};
