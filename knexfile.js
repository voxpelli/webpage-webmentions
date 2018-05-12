'use strict';

const { db: connection } = require('./lib/config');
const db = {
  client: 'pg',
  connection
};

module.exports = {
  development: db,
  staging: db,
  production: db
};
