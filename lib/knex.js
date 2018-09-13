'use strict';

module.exports = require('knex')({
  client: 'pg',
  connection: require('./config').db
});
