/*jslint node: true */

"use strict";

var LRU = require('lru-cache'),
  _ = require('lodash'),
  knex = require('../knex'),
  options = require('../config'),
  RequestBroker = require('../classes/requestbroker'),
  MetaDataFetcher = require('../classes/metadatafetcher'),
  WebMentionBroker = require('../classes/webmentionbroker'),
  urlTools = require('../utils/url-tools'),
  url = require('url'),
  qs = require('querystring'),
  PGPubsub = require('pg-pubsub'),
  EventEmitter = require('events').EventEmitter,
  cors = require('cors'),
  pubsub,
  mentionsCache,
  mentionsArguments,
  eventVariants,
  resolveDerivedData,
  distillMention,
  distillTargets,
  buildMentionTree,
  getTargetQuery,
  getMention,
  getMentions,
  pingSuccessResponse,
  pingErrorResponse,
  isSingleTarget,
  handleCuttingEdgeEmbed,
  handleLegacyEmbed,
  mentionsEmitter = new EventEmitter(),
  requestBroker = new RequestBroker(),
  metaDataFetcher = new MetaDataFetcher(requestBroker),
  broker = new WebMentionBroker(requestBroker);

metaDataFetcher.on('metadata', function (entry, context) {
  if (context.responsesFor) {
    _(entry.getData().raw.microformats.items || [])
      .map(function (item) {
        var url = item.properties || {};

        url = url.url || [];
        url = url[0];

        if (url && urlTools.isHttpUrl.test(url)) {
          return url;
        }
      })
      .filter()
      .forEach(function (url) {
        requestBroker.add('metadata', url, {
          commentOf: context.responsesFor,
        });
      });

    return;
  }

  var target = context.target || context.commentOf;
  var direct = !!context.target;

  if (target && !entry.addTarget(target, direct)) {
    return;
  }

  entry.save();
});

requestBroker.on('metadata', function (url, context) {
  // Fetch the metadata and then process it differently depending on context

  //TODO: Check if its already fetched before? Or just fetch always?

  metaDataFetcher.add(url, context);
});

requestBroker.on('endpoint', function (/* url, context */) {
  // Send the mention as intended
});

mentionsEmitter.setMaxListeners(0);

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
    _.union(mention.targets, mention.removedTargets).forEach(function (target) {
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

resolveDerivedData = function (data) {
  var matchingInteractionTargets;

  if (data.type !== 'mention') {
    matchingInteractionTargets = _.intersection(
      _.map(data.targets, urlTools.normalizeUrl),
      _.map(data.interactions, urlTools.normalizeUrl)
    );

    data.interactionTarget = (matchingInteractionTargets.length !== 0);
  }

  return data;
};

distillMention = function (row) {
  if (!row || !row.data) {
    return false;
  }

  var data = _.pick(row.data, ['url', 'name', 'published', 'summary', 'author', 'interactionType', 'interactions']);

  data.author = _.pick(data.author || {}, ['name', 'photo', 'url']);

  data.url = data.url || row.url;
  data.targets = row.targets || [];
  data.type = row.type || data.interactionType || 'mention';
  data.interactions = data.interactions || [];
  data.parents = row.parents;
  data.id = row.id;

  if (row.removedTargets || row.removedTargets === null) {
    data.removedTargets = row.removedTargets || [];
  }

  data = resolveDerivedData(data);

  delete data.interactionType;

  return data;
};

distillTargets = function (mention, target) {
  var isTarget;

  isTarget = function (checkTarget) {
    var result = false;
    var checkNormalized = urlTools.normalizeUrl(checkTarget);
    var checkSite = url.parse(checkNormalized).hostname;

    if (!_.isEmpty(target.url)) {
      result = [].concat(target.url).some(function (targetUrl) {
        return checkNormalized === urlTools.normalizeUrl(targetUrl);
      });
    }
    if (!result && !_.isEmpty(target.site)) {
      result = [].concat(target.site).some(function (targetSite) {
        return checkSite === targetSite;
      });
    }
    if (!result && !_.isEmpty(target.path)) {
      result = [].concat(target.path).some(function (targetPath) {
        return checkNormalized.indexOf(targetPath) === 0;
      });
    }

    return result;
  };

  mention = _.cloneDeep(mention);
  mention.targets = _.filter(mention.targets, isTarget);
  mention.removedTargets = _.filter(mention.removedTargets, isTarget);

  mention = resolveDerivedData(mention);

  return mention;
};

buildMentionTree = function (mentions) {
  var mentionsById = {};

  mentions.forEach(function (mention) {
    mentionsById[mention.id] = mention;
  });

  mentions.forEach(function (mention) {
    mention.parents.forEach(function (parentId) {
      var existing = [mention], circular = false;

      var check = function (mention) {
        return mention.id === parentId;
      };

      if (parentId !== 0) {
        while (existing.length) {
          if (existing.some(check)) {
            circular = true;
            break;
          }
          existing = existing.reduce(function (submentions, mention) {
            return submentions.concat(mention.mentions || []);
          }, []);
        }

        if (!circular) {
          mentionsById[parentId].mentions = mentionsById[parentId].mentions || [];
          mentionsById[parentId].mentions.push(mention);
        }
      }
    });
  });

  mentions.forEach(function (mention) {
    if (mention.parents.indexOf(0) === -1) {
      delete mentionsById[mention.id];
    }

    delete mention.id;
    delete mention.parents;
  });

  return _.values(mentionsById);
};

getMention = function (entryId) {
  var targets = knex('mentions').as('targets')
    .select(knex.raw('array_agg(mentions.url)'))
    .whereRaw('mentions.eid = entries.id')
    .where('removed', false);

  var removed = knex('mentions').as('removedTargets')
    .select(knex.raw('array_agg(mentions.url)'))
    .whereRaw('mentions.eid = entries.id')
    .where('removed', true);

  var query = knex('entries')
    .first(
      'entries.url as url',
      'data',
      'type',
      targets,
      removed
    )
    .where('id', entryId);

  return query.then(distillMention);
};

getTargetQuery = function (target, options) {
  var query = knex('mentions').distinct('eid');

  query = query.where(function() {
    if (!_.isEmpty(target.url)) {
      //TODO: Validate URL?
      target.url = _.isArray(target.url) ? target.url : [target.url];
      this.orWhereIn('mentions.normalizedUrl', _.map(target.url, urlTools.normalizeUrl));
    }
    if (!_.isEmpty(target.site)) {
      target.site = _.isArray(target.site) ? target.site : [target.site];
      this.orWhereIn('mentions.hostname', _.map(target.site, function (hostname) {
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
        this.orWhere('normalizedUrl', 'like', urlTools.normalizeUrl(path).replace(/\\/g, '').replace(/[%_]/g, '\\%') + '%');
      }.bind(this));
    }
  });

  query = query.where('mentions.removed', false);

  if (options.interactions === true) {
    query = query.where('interaction', true);
  }

  return query;
};

getMentions = function (target, options) {
  target = target || {};
  options = options || {};

  if (!_.isPlainObject(target)) {
    target = { url: target };
  }

  if (target.example !== undefined) {
    return Promise.resolve(require('../utils/sample-data').mentions(14, options)).then(function (mentions) {
      return _.map(mentions, function (example) {
        return distillMention({
          data : example,
          type : example.type,
          targets : example.targets,
        });
      });
    }).catch(function (err) {
      console.warn(err);
      console.log(err.stack);
      return [];
    });
  } else if (!target.url && !target.site && !target.path) {
    return Promise.resolve([]);
  }

  var fullQuery,
    entryQuery = knex('entries'),
    query = getTargetQuery(target, options),
    interactionTypes = ['like', 'repost'];

  entryQuery = entryQuery.select(
      'entries.url as url',
      'data',
      'type',
      knex.raw('array_agg(allmentions.url) as targets'),
      knex.raw('array_agg(allmentions.parent) as parents'),
      'id'
    )
    .innerJoin('allmentions', 'entries.id', 'allmentions.eid')
    .groupBy('entries.id')
    .orderBy('published', options.sort === 'desc' ? 'desc' : 'asc');

  if (options.interactions === true) {
    entryQuery = entryQuery.whereIn('type', interactionTypes);
  } else if (options.interactions === false) {
    entryQuery = entryQuery.where(function() {
      this.whereNotIn('type', interactionTypes);
      this.orWhereNull('type');
    });
  }

  query = query.select(knex.raw('0'), 'normalizedUrl', 'url').union(function() {
    this.select('mentions.eid', 'allmentions.eid', 'mentions.normalizedUrl', 'mentions.url')
      .from('mentions')
      .innerJoin('entries', 'entries.normalizedUrl', 'mentions.normalizedUrl')
      .innerJoin('allmentions', 'entries.id', 'allmentions.eid')
      .where('mentions.removed', false);
  });

  fullQuery = knex.raw('WITH RECURSIVE "allmentions"("eid", "parent", "normalizedUrl", "url") AS (' + query +  ') ' + entryQuery + '');

  return fullQuery
    .then(function (result) {
      return result.rows
        .map(distillMention)
        .map(function (row) {
          return options.distillTargets ? distillTargets(row, target) : row;
        });
    })
    .then(buildMentionTree)
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
      return _.cloneDeep(mentionsCache.get(target) || []);
    });
};

pingSuccessResponse = function (res, syncType) {
  if (res.headersSent) {
    return;
  }

  var statusCode = syncType === 'sync' ? 200 : 202;

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
  if (err.name !== 'WebMentionPingError') {
    console.warn(err);
    console.log(err.stack);
  }

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

isSingleTarget = function (req) {
  return !req.query.path && !req.query.site && (!_.isArray(req.query.url) || !req.query.url[1]);
};

handleCuttingEdgeEmbed = function (app, req, res, next) {
  var nofacepile = req.query.nofacepile !== undefined;

  Promise.all([
    getMentions(mentionsArguments(req), {
      interactions: nofacepile ? undefined : false,
      sort: req.query.sort ? req.query.sort.toLowerCase() : undefined,
      distillTargets: true,
    }),
    nofacepile ? Promise.resolve([]) : getMentions(mentionsArguments(req), {
      interactions: true,
      sort: req.query.sort ? req.query.sort.toLowerCase() : undefined,
    }),
  ]).then(function (result) {
    var mentions = result[0],
      interactions = result[1],
      query = _.clone(req.query),
      singleTarget = isSingleTarget(req),
      templateOptions;

    delete query.version;

    templateOptions = {
      baseUrl: (options.https ? 'https://' : 'http://') + options.hostname,
      query: qs.stringify(query),
      singleTarget: singleTarget,
      showContext: !req.query.nocontext && !singleTarget,
    };

    if (nofacepile) {
      templateOptions.nofacepile = true;
    }

    app.get('theme engine')
      .render('cutting-edge-embed', {
        interactions: interactions,
        mentions: mentions,
        options: templateOptions,
      })
      .then(function (result) {
        res.setHeader('Content-Type', 'text/javascript');
        res.send(result);
      })
      .catch(next);
  });
};

handleLegacyEmbed = function (app, req, res, next) {
  getMentions(mentionsArguments(req), {
    sort: req.query.sort ? req.query.sort.toLowerCase() : undefined,
  }).then(function (mentions) {
    // Remove unneeded data
    mentions = _.map(mentions, function (mention) {
      return _.omit(mention, ['targets', 'interactions']);
    });

    // And render the embed script
    app.get('theme engine')
      .render('embed', {
        mentions: mentions,
        options: {
          baseUrl: (options.https ? 'https://' : 'http://') + options.hostname,
          query: qs.stringify(req.query),
        },
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
      options.interactions = req.query.interactions === '0' ? false : true;
    }

    if (_.isString(req.query.sort)) {
      options.sort = req.query.sort.toLowerCase();
    } else if (format !== 'json') {
      options.sort = 'desc';
    }

    getMentions(mentionsArguments(req), options)
      .then(function (mentions) {
        if (format === 'json') { return mentions; }

        if (format !== 'html') {
          res.sendStatus(400);
          return;
        }

        return app.get('theme engine').recursiveRenderer({
          templateWrappers : ['page'],
          children : [{
            template: 'mentions',
            mentions: mentions,
            singleTarget: singleTarget,
            showContext: !req.query.nocontext && !singleTarget,
            mentionsArguments: mentionsArguments(req),
          }],
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

    //TODO: Send ID:s to make reconnect gapless

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

    var lastMention,
      targetQuery = mentionsArguments(req),
      events = eventVariants(targetQuery);

    var sendEvent = function (mention) {
      if (mention === lastMention) {
        return;
      }
      lastMention = mention;
      mention = distillTargets(mention, targetQuery);
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
        templateWrappers : ['page'],
        children : [{ template: 'info' }],
      })
      .then(res.send.bind(res))
      .catch(next);
  });

  app.post('/api/webmention', function (req, res) {
    var syncFetching = req.query.sync !== undefined,
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

    broker
      .addToQueue(req.body.source, req.body.target, syncFetching)
      .then(successResponse, errorResponse);

  });

  return {
    close: function () {
      pubsub.close();
      broker.close();

      while (liveRequests.length) {
        liveRequests[0]();
      }
    }
  };
};
