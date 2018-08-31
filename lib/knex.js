'use strict';

const pathModule = require('path');

const db = Object.freeze({
  client: 'pg',
  connection: require('./config').db,
  migrations: {
    install: pathModule.join(__dirname, './lib/install-schema'),
    directory: pathModule.join(__dirname, './migrations')
  }
});

module.exports = {
  development: db,
  staging: db,
  production: db
};
