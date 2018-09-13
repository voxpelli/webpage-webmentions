'use strict';

const pathModule = require('path');

const { db: connection } = require('./lib/config');

const db = {
  client: 'pg',
  connection,
  migrations: {
    install: pathModule.join(__dirname, './lib/install-schema'),
    directory: pathModule.join(__dirname, './migrations')
  }
};

module.exports = {
  development: db,
  staging: db,
  production: db
};
