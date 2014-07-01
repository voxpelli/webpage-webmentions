var options = require('./lib/config'),
  db = {
    client: 'pg',
    connection: options.db
  };

module.exports = {
  development: db,
  staging: db,
  production: db
};
