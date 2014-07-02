/*jslint node: true, white: true, indent: 2 */

"use strict";

var url = require('url'),
  request = require('request'),
  cheerio = require('cheerio'),
  microformats = require('microformat-node'),
  LRU = require('lru-cache'),
  Promise = require('promise'),
  knex = require('../knex'),
  options = require('../config'),
  mentionsCache,
  throttledKeys = {},
  throttleTimestamp,
  throttleByKey,
  getMentions;

mentionsCache = LRU({
  max: options.mentionsCacheLimit || 10000,
  length: function (n) {
    return n.length;
  }
});

request = request.defaults({
  jar: false,
  timeout: 5000,
  maxRedirects : 9,
  headers: {
    'User-Agent' : 'A-WebMention-Endpoint/' + options.version + ' (https://github.com/voxpelli/webpage-webmentions)'
  }
});

// Utility functions

//TODO: Sync throttle between workers
//TODO: Ensure that the throttle persists between reboots of the app (enable eg. quick shutdowns on SIGTERM)
throttleByKey = function (key, onWaitCallback) {
  return new Promise(function (resolve, reject) {
    var now = Date.now(), time = Math.floor(now / options.throttleSpan), wait, err;

    if (
      options.env === 'development' &&
      !options.dev.throttling &&
      (key === '127.0.0.1' || key === 'localhost')
    ) {
      // Don't throttle local pings in development environments
    } else if (throttleTimestamp !== time) {
      // Divide the time into timeslots and open up new requests whenever there's a new timeslot
      throttleTimestamp = time;
      throttledKeys = {};
    } else if (throttledKeys[key]) {
      if (!options.throttleCap || throttledKeys[key] < options.throttleCap) {
        // We're throttled – lets wait and try again when there's a new timeslot!

        //TODO: What is happening here? The throttleSpan tells the minimum gap between each request – yet all requests are scheduled to practially retry at the same time? Is that because we need to reinitialize throttledKeys[key] variable on each timeSpan and therefore need all requests to reregister again? Surely there can be a more elegant solution to that.
        wait = (time + 1) * options.throttleSpan - now + throttledKeys[key];
        console.log('Throttled! In', wait, 'milliseconds retrying key:', key);
        
        setTimeout(function () {
          throttleByKey(key).then(resolve, reject);
        }, wait);
        throttledKeys[key] += 1;

        if (onWaitCallback) {
          // If we need to wait, then we might want to eg. respond to the browser early
          onWaitCallback();
        }

        return;
      } else {
        // We're throttled – but there's too many waiting already so we won't get in line

        console.log('Reached throttle cap of', options.throttleCap, 'for key:', key);
        err = new Error('Too many mentions from source host at the moment.');
        err.status = 503;
        reject(err);

        return;
      }
    }

    // Nothing is stopping us – all lights are green – go go go!
    throttledKeys[key] = 1;
    resolve();
  });
};

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
    var source, target, sourceHost, targetHost, responded;

    if (!req.body.source || !req.body.target) {
      res.json(400, {
        error : true,
        message : 'You need to specify both a "source" and a "target" URL'
      });
      return;
    }

    source = req.body.source;
    target = req.body.target;

    sourceHost = url.parse(source).hostname;
    targetHost = url.parse(target).hostname;

    //TODO: Break the below up into methods to allow for more granular error handling

    knex('sites').first('aid').where('hostname', targetHost).then(function (row) {
      if (!row) {
        console.log('Invalid target site:', targetHost);

        var err = new Error('Invalid target site');
        err.status = 400;
        throw(err);
      }
    })
    .then(function () {
      var sendAccepted = function () {
        if (!responded) {
          responded = true;
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
        }
      };
      
      return throttleByKey(sourceHost, sendAccepted).then(sendAccepted);
    })
    .then(function () {
      return new Promise(function (resolve, reject) {
        request({ uri: source }, function (err, response, body) {
          if (err) {
            reject(err);
          } else {
            resolve([response, body]);
          }
        });
      });
    })
    .then(function (result) {
      var $, links, linked, i, length, href,
        response = result[0],
        body = result[1];

      if (response.statusCode !== 200) {
        throw new Error('Expected HTTP code 200');
      }

      $ = cheerio.load(body);
      links = $('a');
      linked = false;

      for (i = 0, length = links.length; i < length; i += 1) {
        href = links.eq(i).attr('href');
        if (href && url.resolve(source, href) === target) {
          linked = true;
          break;
        }
      }

      if (!linked) {
        console.log("Couldn't find a link from source to target", source, target);
        throw new Error("Couldn't find a link from source to target");
      } else {
        console.info('Microformatparsing');
        return Promise.denodeify(microformats.parseDom)($, $.root(), {
          filters : ['h-entry']
        });
      }
    })
    .then(function (data) {
      var entryUrl = source,
        entry = {},
        item,
        author;

      if (data.items.length) {
        item = data.items[0].properties;
        entryUrl = item.url ? url.resolve(source, item.url[0]) : source;
        author = item.author ? item.author[0].properties : {};

        entry.name = item.name ? item.name[0] : null;
        entry.published = item.published ? Date.parse(item.published[0]) : Date.now();
        entry.summary = item.summary ?
          item.summary[0] :
          (item.content ? item.content[0].value : null);

        entry.author = {
          name : author.name ? author.name[0] : null,
          photo : author.photo ? url.resolve(source, author.photo[0]) : null,
          url : author.url ? url.resolve(source, author.url[0]) : null
        };

        if (entry.name === entry.summary) {
          entry.name = null;
        }

        if (entry.summary.length > 512) {
          entry.summary = entry.summary.substr(0, 512);
        }
      } else {
        entry.published = Date.now();
      }

      //TODO: Make all of the three inserts/updates in one nice transaction!
      return knex('entries').insert({
        url : entryUrl,
        data : entry,
        raw : data
      }, 'id');
    })
    .then(function (id) {
      return Promise.all([
        knex('mentions').insert({
          url : target,
          eid : id[0],
          hostname : targetHost
        }),
        knex('sites').update('lastmention', knex.raw('NOW()')).where('hostname', targetHost)
      ]);
    })
    .then(undefined, function (err) {
      console.warn(err);
      console.log(err.stack);

      if (responded) {
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
    });
  });
};
