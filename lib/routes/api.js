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
  url = require('url'),
  qs = require('querystring'),
  PGPubsub = require('pg-pubsub'),
  EventEmitter = require('events').EventEmitter,
  cors = require('cors'),
  noop = function () {},
  pubsub,
  mentionsCache,
  mentionsArguments,
  eventVariants,
  distillMention,
  getMention,
  getMentions,
  pingSuccessResponse,
  pingErrorResponse,
  mentionsEmitter = new EventEmitter();

pubsub = new PGPubsub(options.db);
pubsub.addChannel('mentions', function (message) {
  if (!message.eid) {
    return;
  }

  console.log('Mention notification!', message);

  getMention(message.eid).then(function (mention) {
    if (!mention) {
      return;
    }
    mention.targets.forEach(function (target) {
      var normalizedTarget = urlTools.normalizeUrl(target);
      var targetHost = url.parse(normalizedTarget).hostname;

      mentionsEmitter.emit('url:' + normalizedTarget, mention);
      mentionsEmitter.emit('site:' + targetHost, mention);
    });
  });
});

mentionsCache = LRU({
  max: options.mentionsCacheLimit || 10000,
  length: function (n) {
    return n.length;
  }
});

// Utility functions

mentionsArguments = function (req) {
  return {
    example: req.query.example !== undefined ? true : undefined,
    url : req.query.url,
    site : req.query.site,
    path : req.query.path,
  };
};

eventVariants = function (target) {
  var variants = [];

  if (!_.isEmpty(target.url)) {
    [].concat(target.url).forEach(function (targetUrl) {
      variants.push('url:' + urlTools.normalizeUrl(targetUrl));
    });
  }
  if (!_.isEmpty(target.site)) {
    [].concat(target.site).forEach(function (targetSite) {
      variants.push('site:' + targetSite);
    });
  }
  if (!_.isEmpty(target.path)) {
    //TODO: Enable listeners for this as well!
  }

  return variants;
};

distillMention = function (row) {
  if (!row || !row.data) {
    return false;
  }

  var data = _.pick(row.data, ['url', 'name', 'published', 'summary', 'author']);

  data.author = _.pick(data.author || {}, ['name', 'photo', 'url']);

  data.url = data.url || row.url;
  data.targets = row.targets;

  return data;
};

getMention = function (entryId) {
  return knex('entries')
    .first('entries.url as url', 'data', knex.raw('array_agg(mentions.url) as targets'))
    .innerJoin('mentions', 'entries.id', 'mentions.eid')
    .where('id', entryId)
    .groupBy('entries.id')
    .then(distillMention);
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
    .map(distillMention)
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

// Route setup

module.exports = function (app) {
  app.get('/api/embed', function (req, res) {
    getMentions(mentionsArguments(req)).then(function (mentions) {
      res.setHeader('Content-Type', 'text/javascript');
      res.render('embed.ejs', {
        mentions: mentions,
        options: {
          baseUrl: (options.https ? 'https://' : 'http://') + options.hostname,
          query: qs.stringify(req.query),
        },
      });
    });
  });

  app.get('/api/mentions', cors(), function (req, res) {
    getMentions(mentionsArguments(req)).then(function (mentions) {
      res.send(mentions);
    });
  });

  var liveRequests = 0;

  app.get('/api/mentions/live', cors(), function (req, res) {
    //TODO: Send ID:s to make reconnect gapless

    liveRequests += 1;

    var closeDown = function() {
      liveRequests -= 1;
      console.log('Disconnecting eventsource request! %d left', liveRequests);
      clearTimeout(heartbeatTimer);
      events.forEach(function (event) {
        mentionsEmitter.removeListener(event, sendEvent);
      });
    };

    // To keep connections alive at eg. Heroku send something at least every 30s
    // but also make sure that we still close possibly dead connections every now and then
    var startTime = Date.now();
    var heartbeatTimer, heartbeat;
    heartbeat = function () {
      if (Date.now() - startTime > 5 * 60 * 1000) {
        console.log('Closing connection after 5 minutes');
        res.end();
        closeDown();
        return;
      }
      res.write('\n');
      heartbeatTimer = setTimeout(heartbeat, 25 * 1000);
    };

    var events = eventVariants(mentionsArguments(req)), lastMention;

    var sendEvent = function (mention) {
      if (mention === lastMention) {
        return;
      }
      lastMention = mention;
      res.write('event: mention\n');
      res.write('data: ' + JSON.stringify(mention) + '\n\n');
    };

    events.forEach(function (event) {
      mentionsEmitter.on(event, sendEvent);
    });

    req.socket.setTimeout(Infinity);
    req.once('close', closeDown);
    console.log('Starting eventsource request %d!', liveRequests);

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });

    heartbeat();
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
      .then(undefined, errorResponse);
  });
};
