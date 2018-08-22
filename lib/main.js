'use strict';

// FIXME: Check if all changes needed when upgrading from Knex 0.7.x to 0.11.x has been done

require('newrelic');

process.on('unhandledRejection', (err, p) => {
  console.log('Unhandled Rejection at:', err);
});

const http = require('http');

const express = require('express');
const bodyParser = require('body-parser');
const VError = require('verror');

const Tema = require('tema');
const options = require('./config');
const app = express();

// Ensure HTTPS is enforced in production environment

if (options.https) {
  app.use((req, res, next) => {
    res.setHeader('Strict-Transport-Security', 'max-age=8640000');

    if (req.get('x-forwarded-proto') !== 'https') {
      if (req.method === 'GET') {
        res.redirect(301, 'https://' + req.host + req.url);
      } else {
        res.status(400).send('Bad request. We require HTTPS. Please make another request using HTTPS.');
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

themeEngine.getPublicPaths().forEach(path => {
  app.use(express.static(path));
});

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Add routes

app.use('/', require('./routes/user'));
const api = require('./routes/api')(app);

app.get('/', (req, res, next) => {
  app.get('theme engine')
    .recursiveRenderer({
      templateWrappers: ['page'],
      children: [{
        template: 'frontpage',
        hostname: options.hostname
      }]
    })
    .then(result => { res.send(result); })
    .catch(err => {
      next(new VError(err, 'Failed to render index page'));
    });
});

app.get('/documentation.html', (req, res, next) => {
  app.get('theme engine')
    .recursiveRenderer({
      templateWrappers: ['page'],
      children: [{ template: 'documentation' }]
    })
    .then(result => { res.send(result); })
    .catch(err => {
      next(new VError(err, 'Failed to render documentation page'));
    });
});

const connections = {};
let server;

const cleanupTasks = function () {
  console.log('Getting ready to shut down. Cleaning up...');

  if (server) {
    const timeout = setTimeout(
      () => {
        console.log('...actively closing server connections...');
        for (let key in connections) {
          connections[key].end();
        }
      },
      options.env === 'production' ? 5000 : 1000
    );

    server.close(() => {
      clearTimeout(timeout);

      // If we've started the DB somewhere, now is the time to close it, when all requests are done.
      require('./knex').destroy();

      console.log('...fully cleaned up! Shutting down.');
    });

    server = false;
  }

  console.log('...closing API...');

  api.close();

  if (!server) {
    require('./knex').destroy();

    console.log('...fully cleaned up! Shutting down.');
  }
};

if (require.main !== module) {
  // Export for use in eg tests
  module.exports = { app, cleanupTasks };
} else {
  // Start server

  server = http.createServer(app);

  server.on('connection', conn => {
    const key = conn.remoteAddress + ':' + conn.remotePort;
    connections[key] = conn;
    conn.on('close', () => {
      delete connections[key];
    });
  });

  server.listen(options.port);

  // Listen for shutdown request and shut down gracefully

  if (options.dev.sigintCleanup) {
    process.on('SIGINT', () => { cleanupTasks(); });
  }
  process.on('SIGTERM', () => { cleanupTasks(); });
}
