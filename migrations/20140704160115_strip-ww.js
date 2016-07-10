'use strict';

exports.up = function (knex) {
  // Remove all of the www. subdomains as those will be ignored anyway
  return knex('sites').update('hostname', knex.raw("regexp_replace(hostname, '^www\\.([^.]+\\.[^.]+)$', '\\1')"));
};

exports.down = function () {};
