/*jslint node: true, white: true, indent: 2 */

"use strict";

var pg = require('pg'),
  ff = require('ff'),
  options = require('./config');

module.exports = function () {
  var args = arguments, f;

  Array.prototype.unshift.call(args, function () {
    pg.connect(options.db, f.slotMulti(2));
  }, function (client, done) {
    f.pass(client);
    f.onComplete(done);
  });

  f = ff.apply(undefined, args);

  return f;
};
