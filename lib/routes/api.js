/*jslint node: true, white: true, indent: 2 */

"use strict";

var url = require('url'),
  request = require('request'),
  cheerio = require('cheerio'),
  microformats = require('microformat-node'),
  LRU = require('lru-cache'),
  ffDb = require('../db'),
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
throttleByKey = function (key, callback) {
  var now = Date.now(), time = Math.floor(now / options.throttleSpan), wait, err;

  if (options.env === 'development' && (key === '127.0.0.1' || key === 'localhost')) {
    // Don't throttle local pings in development environments
  } else if (throttleTimestamp !== time) {
    throttleTimestamp = time;
    throttledKeys = {};
  } else if (throttledKeys[key]) {
    if (!options.throttleCap || throttledKeys[key] < options.throttleCap) {
      wait = (time + 1) * options.throttleSpan - now + throttledKeys[key];
      console.log('Throttled! In', wait, 'milliseconds retrying key:', key);
      setTimeout(function () {
        throttleByKey(key, callback);
      }, wait);
      throttledKeys[key] += 1;
      return false;
    } else {
      console.log('Reached throttle cap of', options.throttleCap, 'for key:', key);
      err = new Error('Too many mentions from source host at the moment.');
      err.status = 503;
      callback(err);
      return true;
    }
  }
  throttledKeys[key] = 1;
  process.nextTick(callback);
  return false;
};

getMentions = function (target, callback, limit, offset) {
  var f = ffDb(function (client) {
    client.query('SELECT e.url, e.data FROM entries AS e INNER JOIN mentions AS m ON e.id = m.eid WHERE m.url = $1 LIMIT $2 OFFSET $3', [
      target, limit || 10, offset || 0
    ], f.slot());
  })
  .onSuccess(function (result) {
    var cleanedResult = [];
    result.rows.forEach(function (value) {
      value.data.url = value.url;
      cleanedResult.push(value.data);
    });
    mentionsCache.set(target, cleanedResult);
  })
  .onError(function (err) {
    console.warn(err);
    console.log(err.stack);
  })
  .onComplete(function () {
    callback(mentionsCache.get(target) || []);
  });
};

// Route setup

module.exports = function (app) {
  app.get('/api/embed', function (req, res) {
    getMentions(req.query.url, function (mentions) {
      res.setHeader('Content-Type', 'text/javascript');
      res.render('embed.ejs', { mentions: mentions });
    })
  });

  app.get('/api/mentions', function (req, res) {
    getMentions(req.query.url, function (mentions) {
      res.send(mentions);
    })
  });

  app.post('/api/webmention', function (req, res, next) {
    var source, target, sourceHost, targetHost, f, client, responded;

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

    f = ffDb(function (pgClient) {
        //TODO: Add caching of this data?
        client = pgClient;
        client.query('SELECT aid FROM sites WHERE hostname = $1', [targetHost], f.slot());
      },
      function (result) {
        if (!result.rows[0]) {
          console.log('Invalid target site:', targetHost);
          var err = new Error('Invalid target site');
          err.status = 400;
          f.fail(err)
        }
      },
      function () {
        // If we have reached the cap then we can get to know that right away
        if (throttleByKey(sourceHost, f.wait())) {
          var err = new Error('Too many mentions from source host at the moment.');
          err.status = 503;
          f.fail(err);
        } else {
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
      },
      function () {
        request({ uri: source }, f.slotMulti(2))
      },
      function (response, body) {
        if (response.statusCode !== 200) {
          f.fail(new Error('Expected HTTP code 200'))
          return;
        }

        var $ = cheerio.load(body),
          links = $('a'),
          linked = false,
          i, length;

        for (i = 0, length = links.length; i < length; i += 1) {
          if (url.resolve(source, links.eq(i).attr('href')) !== links.eq(i).attr('href')) {
            console.log(url.resolve(source, links.eq(i).attr('href')));
          }
          if (url.resolve(source, links.eq(i).attr('href')) === target) {
            linked = true;
            break;
          }
        }

        if (!linked) {
          console.log("Couldn't find a link from source to target", source, target);
          f.fail(new Error("Couldn't find a link from source to target"));
        } else {
          console.info('Microformatparsing');
          microformats.parseDom($, $.root(), {
            filters : ['h-entry']
          }, f.slot());
        }
      },
      function (data) {
        var entryUrl = source
          , entry = {}
          , item
          , author;

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

        client.query('INSERT INTO entries (url, data, raw) VALUES ($1, $2, $3) RETURNING id', [entryUrl, entry, data], f.slot());
      },
      function (result) {
        client.query('INSERT INTO mentions (url, eid) VALUES ($1, $2)', [target, result.rows[0].id], f.slot());
        res.json({
          success : true
        });
      }
    ).onError(function (err) {
      console.warn(err);
      console.log(err.stack);

      if (responded) {
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
