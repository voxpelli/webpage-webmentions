// @ts-check
/// <reference types="node" />

'use strict';

const union = require('lodash.union');
const isEmpty = require('lodash.isempty');
const omit = require('lodash.omit');
const knex = require('../knex');
const options = require('../config');
const RequestBroker = require('../classes/requestbroker');
const MetaDataFetcher = require('../classes/metadatafetcher');
const WebMentionBroker = require('../classes/webmentionbroker');
const Entries = require('../classes/entries');
const { getUValues } = require('../utils/mf-tools');
const { normalizeUrl, isHttpUrl } = require('../utils/url-tools');
const request = require('../utils/request');
const url = require('url');
const qs = require('querystring');
const PGPubsub = require('pg-pubsub');
const EventEmitter = require('events').EventEmitter;
const cors = require('cors');
const VError = require('verror');

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
  let ret = ex.stack || ex.toString();
  if (ex.cause && typeof (ex.cause) === 'function') {
    const cex = ex.cause();
    if (cex) {
      ret += '\nCaused by: ' + getFullErrorStack(cex);
    }
  }
  return (ret);
};

metaDataFetcher.on('error', err => {
  console.error('Received on error on metadata fetch:', err.message, getFullErrorStack(err));
});

metaDataFetcher.on('metadata', (entry, context) => {
  if (context.responsesFor) {
    const fetchChain = (context.fetchChain || []).concat(entry.normalizedSource);

    ((entry.getData().raw.microformats || {}).items || [])
      .map(item => (getUValues(item, 'url') || [])[0])
      .filter(url => url && !fetchChain.includes(normalizeUrl(url)))
      .forEach(url => {
        requestBroker.add('metadata', url, {
          fetchChain,
          commentOf: context.responsesFor
        });
      });

    return;
  }

  const target = context.target || context.commentOf;
  const direct = !!context.target;

  if (context.salmentionUpdate || context.webmention) {
    // We want to let them all through
  } else if (target && !entry.addTarget(target, direct)) {
    return;
  }

  entry.save(context).then(() => {
    if (context.webmention) {
      entry.ping(context.webmention);
    } else if (context.salmentionUpdate) {
      entry.pingMentions();
    } else {
      entry.findSalmentionTargets();
    }
  }).catch(err => { console.error('Encountered an error: ' + err.stack); });
});

requestBroker.on('metadata', (url, context) => {
  // Fetch the metadata and then process it differently depending on context

  // TODO: Check if its already fetched before? Or just fetch always?

  metaDataFetcher.add(url, context);
});

requestBroker.on('webmention', (url, context) => {
  request.post({
    url,
    form: {
      source: context.source,
      target: context.target
    }
  }, (err, res) => {
    if (err || res.statusCode > 299) {
      console.error('Failed to ping webmention:', err || ('Invalid status code ' + res.statusCode));
    } else {
      // TODO: log the success or something
    }
  });
});

mentionsEmitter.setMaxListeners(0);

const pubsub = new PGPubsub(options.db);
pubsub.addChannel('mentions', message => {
  if (!message.eid) {
    return;
  }

  console.log('Mention notification!', message);

  entryCollection.get(message.eid)
    .then(mention => {
      if (!mention) {
        return;
      }
      union(mention.targets, mention.removedTargets).forEach(target => {
        const normalizedTarget = normalizeUrl(target);
        const targetHost = url.parse(normalizedTarget).hostname;

        mentionsEmitter.emit('url:' + normalizedTarget, mention);
        mentionsEmitter.emit('site:' + targetHost, mention);
      });
    })
    .catch(err => { console.error('Encountered an error: ' + err.stack); });
});

// Utility functions

/**
 * @param {import('express').Request} req
 * @returns {import('../classes/entries').EntryTarget}
 */
const mentionsArguments = function (req) {
  return {
    example: req.query.example !== undefined ? true : undefined,
    url: req.query.url,
    site: req.query.site,
    path: req.query.path
  };
};

const eventVariants = function (target) {
  const variants = [];

  if (!isEmpty(target.url)) {
    [].concat(target.url).forEach(targetUrl => {
      variants.push('url:' + normalizeUrl(targetUrl));
    });
  }
  if (!isEmpty(target.site)) {
    [].concat(target.site).forEach(targetSite => {
      variants.push('site:' + targetSite);
    });
  }
  if (!isEmpty(target.path)) {
    // TODO: Enable listeners for this as well!
  }

  return variants;
};

const pingSuccessResponse = function (res, syncType) {
  if (res.headersSent) {
    return;
  }

  const statusCode = syncType === 'sync' ? 200 : 202;

  res.format({
    'application/json': () => {
      res.status(statusCode).send({ pending: true, message: 'WebMention accepted' });
    },
    'text/plain': () => {
      res.status(statusCode).send('WebMention accepted');
    },
    default: () => {
      res.status(statusCode).send();
    }
  });
};

const pingErrorResponse = function (res, err) {
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

  if ((err.status > 399 && err.status < 500) || err.status === 503) {
    response.message = err.message;
  }

  if (err.status === 503 && err.retryAfter) {
    res.set('Retry-After', err.retryAfter);
  }

  res.format({
    'application/json': () => {
      res.send(status, response);
    },
    'text/plain': () => {
      res.send(status, response.message);
    },
    default: () => {
      res.send(status, undefined);
    }
  });
};

const isSingleTarget = function (req) {
  return !req.query.path && !req.query.site && (!Array.isArray(req.query.url) || !req.query.url[1]);
};

const handleCuttingEdgeEmbed = function (app, req, res, next) {
  const nofacepile = req.query.nofacepile !== undefined;

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
  ]).then(result => {
    const mentions = result[0];
    const interactions = result[1];
    const query = Object.assign({}, req.query);
    const singleTarget = isSingleTarget(req);

    delete query.version;

    const templateOptions = {
      baseUrl: (options.https ? 'https://' : 'http://') + options.hostname,
      query: qs.stringify(query),
      singleTarget,
      showContext: !req.query.nocontext && !singleTarget
    };

    if (nofacepile) {
      templateOptions.nofacepile = true;
    }

    return app.get('theme engine')
      .render('cutting-edge-embed', {
        interactions,
        mentions,
        options: templateOptions
      });
  }).then(result => {
    res.setHeader('Content-Type', 'text/javascript');
    res.send(result);
  }).catch(err => {
    next(new VError(err, 'Failed to render cutting edge embed'));
  });
};

const handleLegacyEmbed = function (app, req, res, next) {
  entryCollection.queryByTarget(mentionsArguments(req), {
    sort: req.query.sort ? req.query.sort.toLowerCase() : undefined
  }).then(mentions => {
    // Remove unneeded data
    mentions = mentions.map(mention => omit(mention, ['targets', 'interactions']));

    // And render the embed script
    return app.get('theme engine')
      .render('embed', {
        mentions,
        options: {
          baseUrl: (options.https ? 'https://' : 'http://') + options.hostname,
          query: qs.stringify(req.query)
        }
      });
  }).then(result => {
    res.setHeader('Content-Type', 'text/javascript');
    res.send(result);
  }).catch(err => {
    next(new VError(err, 'Failed to render legacy embed'));
  });
};

// Route setup

// TODO: Convert to express.Router()
module.exports = function (app) {
  app.get('/api/embed', (req, res, next) => {
    if (req.query.version === 'cutting-edge') {
      handleCuttingEdgeEmbed(app, req, res, next);
    } else {
      handleLegacyEmbed(app, req, res, next);
    }
  });

  app.get('/api/mentions', cors(), (req, res) => {
    const format = (req.query.format || 'json').toLowerCase();
    const singleTarget = isSingleTarget(req);
    const options = {};

    if (typeof req.query.interactions === 'string') {
      options.interactions = req.query.interactions !== '0';
    }

    if (typeof req.query.sort === 'string') {
      options.sort = req.query.sort.toLowerCase();
    } else if (format !== 'json') {
      options.sort = 'desc';
    }

    // TODO: Stream the response back instead
    entryCollection.queryByTarget(mentionsArguments(req), options)
      .then(mentions => {
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
      .then(mentions => {
        if (!mentions) {
          throw new Error('Found no mentions');
        }
        res.send(mentions);
      })
      .catch(err => {
        console.log(err);
        res.status(500).send({ error: 'An error occurred' });
      });
  });

  const liveRequests = [];

  app.get('/api/mentions/live', cors(), (req, res) => {
    let heartbeatTimer, lastMention;

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    });

    // TODO: Send ID:s to make reconnect gapless

    const closeDown = () => {
      const pos = liveRequests.indexOf(closeDown);

      if (pos !== -1) {
        liveRequests.splice(pos, 1);
      }

      console.log('Disconnecting eventsource request! %d left', liveRequests.length);

      res.end();
      clearTimeout(heartbeatTimer);
      events.forEach(event => {
        mentionsEmitter.removeListener(event, sendEvent);
      });
    };

    liveRequests.push(closeDown);

    // To keep connections alive at eg. Heroku send something at least every 30s
    // but also make sure that we still close possibly dead connections every now and then
    const startTime = Date.now();
    const heartbeat = () => {
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

    const sendEvent = (mention) => {
      if (mention === lastMention) {
        return;
      }
      lastMention = mention;
      // TODO: Should not access private method
      mention = entryCollection._distillTargets(mention, targetQuery);
      res.write('event: mention\n');
      res.write('data: ' + JSON.stringify(mention) + '\n\n');
    };

    events.forEach(event => {
      mentionsEmitter.on(event, sendEvent);
    });

    req.socket.setTimeout(10 * 60 * 1000);
    req.once('close', closeDown);
    console.log('Starting eventsource request %d!', liveRequests.length);

    heartbeat();
  });

  app.get('/api/webmention', (req, res, next) => {
    app.get('theme engine')
      .recursiveRenderer({
        templateWrappers: ['page'],
        children: [{ template: 'info' }]
      })
      .then(result => { res.send(result); })
      .catch(err => { next(new VError(err, 'Failed to render endpoint GET info page')); });
  });

  app.post('/api/webmention', (req, res) => {
    const syncFetching = req.query.sync !== undefined;
    const { source, target } = req.body;

    // Validate the request

    if (
      !source ||
      !target ||
      !isHttpUrl.test(source) ||
      !isHttpUrl.test(target)
    ) {
      res.status(400).json({
        error: true,
        message: 'You need to specify both a valid "source" and a valid "target" URL'
      });
      return;
    }

    if (source === target || normalizeUrl(source) === normalizeUrl(target)) {
      res.status(400).json({
        error: true,
        message: '"source" and "target" URL are not allowed to be identical'
      });
      return;
    }

    // Process the ping

    broker
      .addToQueue(source, target, syncFetching)
      .then(syncType => { pingSuccessResponse(res, syncType); })
      .catch(err => { pingErrorResponse(res, err); });
  });

  return {
    close: () => {
      pubsub.close();
      requestBroker.close();

      while (liveRequests.length) {
        liveRequests[0]();
      }
    }
  };
};
