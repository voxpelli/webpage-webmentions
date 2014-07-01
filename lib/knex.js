/*jslint node: true, white: true, indent: 2 */

"use strict";

module.exports = require('knex')({
  client: 'pg',
  connection: require('./config').db
});
