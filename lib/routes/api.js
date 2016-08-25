'use strict';

const _ = require('lodash');
const knex = require('../knex');
const options = require('../config');
const RequestBroker = require('../classes/requestbroker');
const MetaDataFetcher = require('../classes/metadatafetcher');
const WebMentionBroker = require('../classes/webmentionbroker');
const Entries = require('../classes/entries');
const mfTools = require('../utils/mf-tools');
const urlTools = require('../utils/url-tools');
const request = require('../utils/request');
const url = require('url');
const qs = require('querystring');
const PGPubsub = require('pg-pubsub');
const EventEmitter = require('events').EventEmitter;
const cors = require('cors');
let pubsub,
  mentionsArguments,
  eventVariants,
  pingSuccessResponse,
  pingErrorResponse,
  isSingleTarget,
  handleCuttingEdgeEmbed,
  handleLegacyEmbed;
const mentionsEmitter = new EventEmitter();
const requestBroker = new RequestBroker();
const entryCollection = new Entries({
  knex,
  requestBroker
});
const metaDataFetcher = new MetaDataFetcher(entryCollection);
const broker = new WebMentionBroker(requestBroker);

// Copied from Bunyan
const getFullErrorStack = function (ex) {
  var ret = ex.stack || ex.toString();
  if (ex.cause && typeof (ex.cause) === 'function') {
    var cex = ex.cause();
    if (cex) {
      ret += '\nCaused by: ' + getFullErrorStack(cex);
    }
  }
  return (ret);
};

metaDataFetcher.on('error', err => {
  console.error('Received on error on metadata fetch:', err.message, getFullErrorStack(err));
});

metaDataFetcher.on('metadata', function (entry, context) {
  if (context.responsesFor) {
    _((entry.getData().raw.microformats || {}).items || [])
      .map(function (item) {
        return (mfTools.getUValues(item, 'url') || [])[0];
      })
      .filter()
      .forEach(function (url) {
        requestBroker.add('metadata', url, {
          commentOf: context.responsesFor
        });
      });

    return;
  }

  var target = context.target || context.commentOf;
  var direct = !!context.target;

  if (context.salmentionUpdate || context.webmention) {
    // We want to let them all through
  } else if (target && !entry.addTarget(target, direct)) {
    return;
  }

  entry.save().then(function () {
    if (context.webmention) {
      entry.ping(context.webmention);
    } else if (context.salmentionUpdate) {
      entry.pingMentions();
    } else {
      entry.findSalmentionTargets();
    }
  });
});

requestBroker.on('metadata', function (url, context) {
  // Fetch the metadata and then process it differently depending on context

  // TODO: Check if its already fetched before? Or just fetch always?

  metaDataFetcher.add(url, context);
});

requestBroker.on('webmention', function (url, context) {
  request.post({
    url: url,
    form: {
      source: context.source,
      target: context.target
    }
  }, function (err, res) {
    if (err || res.statusCode > 299) {
      console.error('Failed to ping webmention:', err || ('Invalid status code ' + res.statusCode));
      return;
    }
    // TODO: log the success or something
  });
});

mentionsEmitter.setMaxListeners(0);

pubsub = new PGPubsub(options.db);
pubsub.addChannel('mentions', function (message) {
  if (!message.eid) {
    return;
  }

  console.log('Mention notification!', message);

  entryCollection.get(message.eid).then(function (mention) {
    if (!mention) {
      return;
    }
    _.union(mention.targets, mention.removedTargets).forEach(function (target) {
      var normalizedTarget = urlTools.normalizeUrl(target);
      var targetHost = url.parse(normalizedTarget).hostname;

      mentionsEmitter.emit('url:' + normalizedTarget, mention);
      mentionsEmitter.emit('site:' + targetHost, mention);
    });
  });
});

// Utility functions

mentionsArguments = function (req) {
  return {
    example: req.query.example !== undefined ? true : undefined,
    url: req.query.url,
    site: req.query.site,
    path: req.query.path
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
    // TODO: Enable listeners for this as well!
  }

  return variants;
};

pingSuccessResponse = function (res, syncType) {
  if (res.headersSent) {
    return;
  }

  var statusCode = syncType === 'sync' ? 200 : 202;

  res.format({
    'application/json': function () {
      res.send(statusCode, { pending: true, message: 'WebMention accepted' });
    },
    'text/plain': function () {
      res.send(statusCode, 'WebMention accepted');
    },
    default: function () {
      res.send(statusCode, undefined);
    }
  });
};

pingErrorResponse = function (res, err) {
  if (err.name !== 'WebMentionPingError') {
    console.warn(err);
    console.log(err.stack);
  }

  if (res.headersSent) {
    // The response has already been sent so not much else we can do with the error
    return;
  }

  const response = { error: true };
  const status = err.status || 500;

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
    default: function () {
      res.send(status, undefined);
    }
  });
};

isSingleTarget = function (req) {
  return !req.query.path && !req.query.site && (!_.isArray(req.query.url) || !req.query.url[1]);
};

handleCuttingEdgeEmbed = function (app, req, res, next) {
  var nofacepile = req.query.nofacepile !== undefined;

  Promise.all([
    entryCollection.queryByTarget(mentionsArguments(req), {
      interactions: nofacepile ? undefined : false,
      sort: req.query.sort ? req.query.sort.toLowerCase() : undefined,
      distillTargets: true
    }),
    nofacepile ? Promise.resolve([]) : entryCollection.queryByTarget(mentionsArguments(req), {
      interactions: true,
      sort: req.query.sort ? req.query.sort.toLowerCase() : undefined
    })
  ]).then(function (result) {
    const mentions = result[0];
    const interactions = result[1];
    const query = _.clone(req.query);
    const singleTarget = isSingleTarget(req);

    delete query.version;

    const templateOptions = {
      baseUrl: (options.https ? 'https://' : 'http://') + options.hostname,
      query: qs.stringify(query),
      singleTarget: singleTarget,
      showContext: !req.query.nocontext && !singleTarget
    };

    if (nofacepile) {
      templateOptions.nofacepile = true;
    }

    app.get('theme engine')
      .render('cutting-edge-embed', {
        interactions,
        mentions,
        options: templateOptions
      })
      .then(function (result) {
        res.setHeader('Content-Type', 'text/javascript');
        res.send(result);
      })
      .catch(next);
  });
};

handleLegacyEmbed = function (app, req, res, next) {
  entryCollection.queryByTarget(mentionsArguments(req), {
    sort: req.query.sort ? req.query.sort.toLowerCase() : undefined
  }).then(function (mentions) {
    // Remove unneeded data
    mentions = _.map(mentions, function (mention) {
      return _.omit(mention, ['targets', 'interactions']);
    });

    // And render the embed script
    app.get('theme engine')
      .render('embed', {
        mentions,
        options: {
          baseUrl: (options.https ? 'https://' : 'http://') + options.hostname,
          query: qs.stringify(req.query)
        }
      })
      .then(function (result) {
        res.setHeader('Content-Type', 'text/javascript');
        res.send(result);
      })
      .catch(next);
  });
};

// Route setup

module.exports = function (app) {
  app.get('/api/embed', function (req, res, next) {
    var version = req.query.version;

    if (version === 'cutting-edge') {
      handleCuttingEdgeEmbed(app, req, res, next);
    } else {
      handleLegacyEmbed(app, req, res, next);
    }
  });

  app.get('/api/mentions', cors(), function (req, res) {
    var format = (req.query.format || 'json').toLowerCase();
    var singleTarget = isSingleTarget(req);
    var options = {};

    if (_.isString(req.query.interactions)) {
      options.interactions = req.query.interactions !== '0';
    }

    if (_.isString(req.query.sort)) {
      options.sort = req.query.sort.toLowerCase();
    } else if (format !== 'json') {
      options.sort = 'desc';
    }

    entryCollection.queryByTarget(mentionsArguments(req), options)
      .then(function (mentions) {
        if (format === 'json') { return mentions; }

        if (format !== 'html') {
          res.sendStatus(400);
          return;
        }

        return app.get('theme engine').recursiveRenderer({
          templateWrappers: ['page'],
          children: [{
            template: 'mentions',
            mentions,
            singleTarget,
            showContext: !req.query.nocontext && !singleTarget,
            mentionsArguments: mentionsArguments(req)
          }]
        });
      })
      .then(function (mentions) {
        if (mentions) {
          res.send(mentions);
        }
      })
      .catch(function (err) {
        console.log(err);
        res.send(500, { error: 'An error occurred' });
      });
  });

  var liveRequests = [];

  app.get('/api/mentions/live', cors(), function (req, res) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });

    // TODO: Send ID:s to make reconnect gapless

    var closeDown = function () {
      var pos = liveRequests.indexOf(closeDown);

      if (pos !== -1) {
        liveRequests.splice(pos, 1);
      }

      console.log('Disconnecting eventsource request! %d left', liveRequests.length);

      res.end();
      clearTimeout(heartbeatTimer);
      events.forEach(function (event) {
        mentionsEmitter.removeListener(event, sendEvent);
      });
    };

    liveRequests.push(closeDown);

    // To keep connections alive at eg. Heroku send something at least every 30s
    // but also make sure that we still close possibly dead connections every now and then
    var startTime = Date.now();
    var heartbeatTimer, heartbeat;
    heartbeat = function () {
      if (Date.now() - startTime > 5 * 60 * 1000) {
        console.log('Closing connection after 5 minutes');
        closeDown();
        return;
      }
      res.write('\n');
      heartbeatTimer = setTimeout(heartbeat, 25 * 1000);
    };

    const targetQuery = mentionsArguments(req);
    const events = eventVariants(targetQuery);
    let lastMention;

    var sendEvent = function (mention) {
      if (mention === lastMention) {
        return;
      }
      lastMention = mention;
      // TODO: Should not access private method
      mention = entryCollection._distillTargets(mention, targetQuery);
      res.write('event: mention\n');
      res.write('data: ' + JSON.stringify(mention) + '\n\n');
    };

    events.forEach(function (event) {
      mentionsEmitter.on(event, sendEvent);
    });

    req.socket.setTimeout(10 * 60 * 1000);
    req.once('close', closeDown);
    console.log('Starting eventsource request %d!', liveRequests.length);

    heartbeat();
  });

  app.get('/api/webmention', function (req, res, next) {
    app.get('theme engine')
      .recursiveRenderer({
        templateWrappers: ['page'],
        children: [{ template: 'info' }]
      })
      .then(res.send.bind(res))
      .catch(next);
  });

  app.post('/api/webmention', function (req, res) {
    const syncFetching = req.query.sync !== undefined;
    const successResponse = pingSuccessResponse.bind(undefined, res);
    const errorResponse = pingErrorResponse.bind(undefined, res);

    // Validate the request

    if (!req.body.source || !req.body.target) {
      res.json(400, {
        error: true,
        message: 'You need to specify both a "source" and a "target" URL'
      });
      return;
    }

    // Process the ping

    broker
      .addToQueue(req.body.source, req.body.target, syncFetching)
      .then(successResponse, errorResponse);
  });

  return {
    close: function () {
      pubsub.close();
      requestBroker.close();

      while (liveRequests.length) {
        liveRequests[0]();
      }
    }
  };
};
