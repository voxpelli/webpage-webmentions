var dbm = require('db-migrate');

exports.up = function(db, callback) {
  var columnDef = {
    type : 'string',
    notNull : false
  };
  db.addColumn('mentions', 'hostname', columnDef, function () {
    db.runSql("UPDATE mentions SET hostname = substring(url, 'https?://([^/:]+)')", function () {
      columnDef.notNull = true;
      db.changeColumn('mentions', 'hostname', columnDef, callback);
    });
  });
};

exports.down = function(db, callback) {
  db.removeColumn('mentions', 'hostname', callback)
};
