var dbm = require('db-migrate'),
  type = dbm.dataType,
  ff = require('ff');

exports.up = function(db, callback) {
  var f = ff(function () {
    db.all("SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='accounts' LIMIT 1", f.slot());
  }, function (results) {
    if (results[0]) {
      // We're apparently already setup with a pre-db-migrate method, so skip this step
      return;
    }

    db.createTable('accounts', {
      id: {type: type.INTEGER, primaryKey: true, autoIncrement: true},
      service: {type: type.STRING, notNull: true},
      external_id: {type: type.STRING, notNull: true},
      created: {type: type.TIMESTAMP, notNull: true},
      lastlogin: {type: type.TIMESTAMP, notNull: true},
      username: type.STRING
    }, f.wait());

    db.createTable('entries', {
      id: {type: type.INTEGER, primaryKey: true, autoIncrement: true},
      url: {type: type.STRING, unique: true, notNull: true},
      data: {type: 'json', notNull: true},
      raw: 'json'
    }, f.wait());

    db.createTable('mentions', {
      eid: {type: type.INTEGER, primaryKey: true},
      url: {type: type.STRING, primaryKey: true}
    }, f.wait());

    db.createTable('sites', {
      aid: {type: type.INTEGER, notNull: true},
      hostname: {type: type.STRING, primaryKey: true},
      created: {type: type.TIMESTAMP, notNull: true},
      lastmention: type.TIMESTAMP
    }, f.wait());
  }).onComplete(callback);
};

exports.down = function(db, callback) {
  var f = ff(function () {
    db.dropTable('accounts', f.wait());
    db.dropTable('entries', f.wait());
    db.dropTable('mentions', f.wait());
    db.dropTable('sites', f.wait());
  }).onComplete(callback);
};
