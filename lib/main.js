/*jslint node: true, white: true, indent: 2 */

"use strict";

require('newrelic');

var express = require('express'),
  http = require('http'),
  options = require('./config'),
  app = express(),
  server;

// Ensure HTTPS is enforced in production environment

if (options.env === 'production') {
  app.use(function (req, res, next) {
    res.setHeader('Strict-Transport-Security', 'max-age=8640000');

    if (req.get('x-forwarded-proto') !== 'https') {
      res.redirect(301, 'https://' + req.host + req.url);
    } else {
      next();
    }
  });
}

// General express setup

app
  .set('views', __dirname + '/../views')
  .set('view engine', 'ejs')
  .set('strict routing', true)
  .set('case sensitive routing', true)
  .use(express.static(__dirname + '/../public'))
  .use(express.json())
  .use(express.urlencoded());

// Add routes

require('./routes/user')(app);
require('./routes/api')(app);

// Start server

server = http.createServer(app);
server.listen(options.port);

// Listen for shutdown request and shut down gracefully

process.on('SIGTERM', function () {
  if (server) {
    server.close();
    server = false;
  }
});
