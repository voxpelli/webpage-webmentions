'use strict';

require('newrelic');

process.on('unhandledRejection', (err, p) => {
  console.log('Unhandled Rejection at:', err);
});

const express = require('express');
const http = require('http');
const Tema = require('tema');
const options = require('./config');
const app = express();

// Ensure HTTPS is enforced in production environment

if (options.https) {
  app.use(function (req, res, next) {
    res.setHeader('Strict-Transport-Security', 'max-age=8640000');

    if (req.get('x-forwarded-proto') !== 'https') {
      if (req.method === 'GET') {
        res.redirect(301, 'https://' + req.host + req.url);
      } else {
        res.send(400, 'Bad request. We require HTTPS. Please make another request using HTTPS.');
      }
    } else {
      next();
    }
  });
}

// Set up theme engine

const themeEngine = new Tema({
  theme: require('../theme'),
  locals: require('./utils/themelocals'),
  defaultToPlain: false
});

// General express setup

app
  .set('theme engine', themeEngine)
  .set('strict routing', true)
  .set('case sensitive routing', true);

themeEngine.getPublicPaths().forEach(function (path) {
  app.use(express.static(path));
});

app.use(express.json());
app.use(express.urlencoded());

// Add routes

require('./routes/user')(app);
var api = require('./routes/api')(app);

app.get('/', function (req, res, next) {
  app.get('theme engine')
    .recursiveRenderer({
      templateWrappers: ['page'],
      children: [{
        template: 'frontpage',
        hostname: options.hostname
      }]
    })
    .then(res.send.bind(res))
    .catch(next);
});
app.get('/documentation.html', function (req, res, next) {
  app.get('theme engine')
    .recursiveRenderer({
      templateWrappers: ['page'],
      children: [{ template: 'documentation' }]
    })
    .then(res.send.bind(res))
    .catch(next);
});

if (require.main !== module) {
  // Export for use in eg tests

  module.exports = app;
} else {
  // Start server

  let server = http.createServer(app);
  server.listen(options.port);

  var connections = {};

  server.on('connection', function (conn) {
    var key = conn.remoteAddress + ':' + conn.remotePort;
    connections[key] = conn;
    conn.on('close', function () {
      delete connections[key];
    });
  });

  // Listen for shutdown request and shut down gracefully

  var cleanupTasks = function () {
    var timeout;

    console.log('Getting ready to shut down. Cleaning up...');

    if (server) {
      timeout = setTimeout(
        function () {
          console.log('...actively closing server connections...');
          for (var key in connections) {
            connections[key].end();
          }
        },
        options.env === 'production' ? 5000 : 1000
      );

      server.close(function () {
        clearTimeout(timeout);

        // If we've started the DB somewhere, now is the time to close it, when all requests are done.
        require('./knex').destroy();

        console.log('...fully cleaned up! Shutting down.');
      });

      server = false;
    }

    api.close();
  };

  if (options.dev.sigintCleanup) {
    process.on('SIGINT', cleanupTasks);
  }
  process.on('SIGTERM', cleanupTasks);
}
