/*jslint node: true */
/* global -Promise */

"use strict";

var LRU = require('lru-cache'),
  _ = require('lodash'),
  Promise = require('promise'),
  knex = require('../knex'),
  options = require('../config'),
  WebMentionPing = require('../classes/webmentionping'),
  urlTools = require('../utils/url-tools'),
  EventEmitter = require('events').EventEmitter,
  noop = function () {},
  mentionsCache,
  mentionsArguments,
  getMentions,
  pingSuccessResponse,
  pingErrorResponse,
  getEventSourceEmitter,
  fireEventSource;

mentionsCache = LRU({
  max: options.mentionsCacheLimit || 10000,
  length: function (n) {
    return n.length;
  }
});

var EVENT_SOURCE_EMITTERS = {};
getEventSourceEmitter = function(args, opts) {
  var key;
  if (args.url) {
    key = "url:" + args.url;
  } else if (args.site) {
    key = "site:" + args.site;
  }
  var e = EVENT_SOURCE_EMITTERS[key];
  if (!e && opts && opts.create) {
    EVENT_SOURCE_EMITTERS[key] = {count:0, e:new EventEmitter()};
  }
  return EVENT_SOURCE_EMITTERS[key];
};

// Utility functions

mentionsArguments = function (req) {
  return {
    example: req.query.example !== undefined ? true : undefined,
    url : req.query.url,
    site : req.query.site,
    path : req.query.path,
  };
};

getMentions = function (target) {
  target = target || {};

  if (!_.isPlainObject(target)) {
    target = { url: target };
  }

  if (target.example !== undefined) {
    return Promise.resolve(require('../utils/sample-data').mentions());
  } else if (!target.url && !target.site && !target.path) {
    return Promise.resolve([]);
  }

  var query = knex('mentions').distinct('eid');

  if (!_.isEmpty(target.url)) {
    //TODO: Validate URL?
    target.url = _.isArray(target.url) ? target.url : [target.url];
    query = query.orWhereIn('mentions.normalizedUrl', _.map(target.url, urlTools.normalizeUrl));
  }
  if (!_.isEmpty(target.site)) {
    target.site = _.isArray(target.site) ? target.site : [target.site];
    query = query.orWhereIn('mentions.hostname', _.map(target.site, function (hostname) {
      if (!urlTools.simpleHostnameValidation.test(hostname)) {
        return undefined;
      }
      try {
        return urlTools.normalizeUrl('http://' + hostname + '/', { raw: true }).hostname;
      } catch (e) {
        return undefined;
      }
    }));
  }
  if (!_.isEmpty(target.path)) {
    target.path = _.isArray(target.path) ? target.path : [target.path];
    _.each(target.path, function (path) {
      query = query.orWhere('normalizedUrl', 'like', urlTools.normalizeUrl(path).replace(/\\/g, '').replace(/[%_]/g, '\\%') + '%');
    });
  }

  return knex('entries')
    .select('entries.url as url', 'data', knex.raw('array_agg(mentions.url) as targets'))
    .innerJoin('mentions', 'entries.id', 'mentions.eid')
    .whereIn('id', query)
    .groupBy('entries.id')
    .orderBy('published', 'asc') //TODO: Add option for instead sort on fetched
    .map(function (row) {
      row.data.url = row.data.url || row.url;
      row.data.targets = row.targets;
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
      return mentionsCache.get(target) || [];
    });
};

pingSuccessResponse = function (res, syncFetching) {
  if (res.headersSent) {
    return;
  }

  var statusCode = syncFetching ? 200 : 202;

  res.format({
    'application/json': function () {
      res.send(statusCode, { pending : true, message : 'WebMention accepted' });
    },
    'text/plain': function () {
      res.send(statusCode, 'WebMention accepted');
    },
    default : function () {
      res.send(statusCode, undefined);
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

  if (err.status === 503 && err.retryAfter) {
    res.set('Retry-After', err.retryAfter);
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

fireEventSource = function() {
  var eForSite = getEventSourceEmitter({site: this.targetHost}),
      eForUrl = getEventSourceEmitter({url: this.target}),
      wmdata = {source: this.source, target: this.target};
    if (eForSite) {
      eForSite.e.emit("webmention", wmdata);
      eForSite.count += 1;
    }
    if (eForUrl) {
      eForUrl.e.emit("webmention", wmdata);
      eForUrl.count += 1;
    }
};

// Route setup

module.exports = function (app) {
  app.get('/api/embed', function (req, res) {
    getMentions(mentionsArguments(req)).then(function (mentions) {
      res.setHeader('Content-Type', 'text/javascript');
      res.render('embed.ejs', { mentions: mentions });
    });
  });

  app.get('/api/mentions', function (req, res) {
    getMentions(mentionsArguments(req)).then(function (mentions) {
      res.send(mentions);
    });
  });

  app.get('/api/mentions/live', function (req, res) {
    var e = getEventSourceEmitter(mentionsArguments(req), {create: true});
    req.socket.setTimeout(Infinity);
    e.e.on("webmention", function(wm) {
      res.write("id:" + e.count + "\n");
      res.write("data:" + JSON.stringify(wm) + "\n\n");
    });
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });
    res.write('\n');
  });

  app.get('/api/webmention', function (req, res) {
    res.render('info.ejs');
  });

  app.post('/api/webmention', function (req, res) {
    var ping,
      syncFetching = req.query.sync !== undefined,
      successResponse = pingSuccessResponse.bind(undefined, res, syncFetching),
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
      .then(ping.throttleFetches.bind(ping, syncFetching ? null : successResponse))
      .then(syncFetching ? noop : successResponse)
      .then(ping.fetchSourcePage.bind(ping))
      .then(ping.parseSourcePage.bind(ping))
      .then(ping.createMention.bind(ping))
      .then(ping.saveMention.bind(ping))
      .then(syncFetching ? successResponse : noop)
      .then(fireEventSource.bind(ping))
      .then(undefined, errorResponse);
  });
};
