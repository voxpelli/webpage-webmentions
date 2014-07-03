/*jslint node: true, white: true, indent: 2 */

"use strict";

var LRU = require('lru-cache'),
  knex = require('../knex'),
  options = require('../config'),
  WebMentionPing = require('../classes/webmentionping'),
  mentionsCache,
  getMentions,
  pingSuccessResponse,
  pingErrorResponse;

mentionsCache = LRU({
  max: options.mentionsCacheLimit || 10000,
  length: function (n) {
    return n.length;
  }
});


// Utility functions

getMentions = function (target, callback, limit, offset) {
  knex('entries')
    .select('entries.url', 'entries.data')
    .innerJoin('mentions', 'entries.id', 'mentions.eid')
    .where('mentions.url', target)
    .limit(limit || 10)
    .offset(offset || 0)
    .map(function (row) {
      row.data.url = row.url;
      return row.data;
    })
    .then(
      function (rows) {
        mentionsCache.set(target, rows);
      },
      function (err) {
        console.warn(err);
        console.log(err.stack);
      }
    )
    .then(function () {
      callback(mentionsCache.get(target) || []);
    });
};

pingSuccessResponse = function (res) {
  if (res.headersSent) {
    return;
  }

  res.format({
    'application/json': function () {
      res.send(202, { pending : true, message : 'WebMention accepted' });
    },
    'text/plain': function () {
      res.send(202, 'WebMention accepted');
    },
    default : function () {
      res.send(202, undefined);
    }
  });
};

pingErrorResponse = function (res, err) {
  console.warn(err);
  console.log(err.stack);

  if (res.headersSent) {
    // The response has already been sent so not much else we can do with the error
    return;
  }

  var response = { error : true }, status = err.status || 500;

  if (err.status > 399 && err.status < 500 || err.status === 503) {
    response.message = err.message;
  }

  res.format({
    'application/json': function () {
      res.send(status, response);
    },
    'text/plain': function () {
      res.send(status, response.message);
    },
    default : function () {
      res.send(status, undefined);
    }
  });
};


// Route setup

module.exports = function (app) {
  app.get('/api/embed', function (req, res) {
    getMentions(req.query.url, function (mentions) {
      res.setHeader('Content-Type', 'text/javascript');
      res.render('embed.ejs', { mentions: mentions });
    });
  });

  app.get('/api/mentions', function (req, res) {
    getMentions(req.query.url, function (mentions) {
      res.send(mentions);
    });
  });

  app.get('/api/webmention', function (req, res) {
    res.render('info.ejs');
  });

  app.post('/api/webmention', function (req, res) {
    var ping,
      successResponse = pingSuccessResponse.bind(undefined, res),
      errorResponse = pingErrorResponse.bind(undefined, res);

    // Validate the request

    if (!req.body.source || !req.body.target) {
      res.json(400, {
        error : true,
        message : 'You need to specify both a "source" and a "target" URL'
      });
      return;
    }

    // Process the ping

    ping = new WebMentionPing(req.body.source, req.body.target);

    ping.isValidTarget()
      .then(ping.throttleFetches.bind(ping, successResponse))
      .then(successResponse)
      .then(ping.fetchSourcePage.bind(ping))
      .then(ping.parseSourcePage.bind(ping))
      .then(ping.createMention.bind(ping))
      .then(ping.saveMention.bind(ping))
      .then(undefined, errorResponse);
  });
};
