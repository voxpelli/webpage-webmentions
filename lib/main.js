"use strict";

var express = require('express'),
  http = require('http'),
  pg = require('pg'),
  ff = require('ff'),
  url = require('url'),
  request = require('request'),
  cheerio = require('cheerio'),
  microformats = require('microformat-node'),
  passport = require('passport'),
  GitHubStrategy = require('passport-github').Strategy,
  DummyStrategy,
  ensureAuthenticated,
  throttledKeys = {},
  throttleTimestamp,
  throttleByKey,
  simpleHostnameValidation = /^[\w\.-]*\w$/,
  ffDb,
  removeSite,
  addSite,
  getMentions,
  server,
  app,
  options;

options = {
  db : process.env.DATABASE_URL,
  env : process.env.NODE_ENV || 'production',
  cookieSecret : process.env.WEBMENTIONS_COOKIE_SECRET,
  hostname : process.env.WEBMENTIONS_HOSTNAME,
  userLimit : process.env.WEBMENTIONS_USER_LIMIT || 6,
  throttleSpan : (process.env.WEBMENTIONS_THROTTLE || 60) * 1000,
  throttleCap : process.env.WEBMENTIONS_THROTTLE_CAP || 10,
  github : {
    client_id : process.env.WEBMENTIONS_GITHUB_ID,
    client_secret : process.env.WEBMENTIONS_GITHUB_SECRET
  }
};

request = request.defaults({
  jar: false,
  timeout: 5000,
  maxRedirects : 9,
  headers: {
    'User-Agent' : 'A-WebMention-Endpoint (https://github.com/voxpelli)'
  }
});

ffDb = function () {
  var args = arguments, f;

  Array.prototype.unshift.call(args, function () {
    pg.connect(options.db, f.slotMulti(2));
  }, function (client, done) {
    f.pass(client);
    f.onComplete(done);
  });

  f = ff.apply(undefined, args);

  return f;
};

ensureAuthenticated = function (req, res, next) {
  if (req.isAuthenticated()) { return next(); }
  var err = new Error('Unauthorized');
  err.status = 401;
  next(err);
};

//TODO: Sync throttle between workers
throttleByKey = function (key, callback) {
  var now = Date.now(), time = Math.floor(now / options.throttleSpan), wait, err;
  if (throttleTimestamp !== time) {
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

passport.serializeUser(function (user, done) {
  done(null, user);
});
passport.deserializeUser(function (user, done) {
  done(null, user);
});
passport.use(new GitHubStrategy({
    clientID: options.github.client_id,
    clientSecret: options.github.client_secret,
    callbackURL: 'http://' + options.hostname + '/user/auth/github/callback'
  },
  function(accessToken, refreshToken, profile, passportDone) {
    var f = ffDb(
      function (client) {
        f.pass(client);
        client.query(
          'UPDATE accounts SET lastlogin = NOW(), username = $1 WHERE external_id = $2 AND service = $3 RETURNING id',
          [profile.username.toLowerCase(), profile.id, 'github'],
          f.slot()
        );
      },
      function (client, result) {
        if (result.rows[0]) {
          f.pass(result);
        } else {
          client.query(
            'INSERT INTO accounts (username, external_id, service) SELECT $1, $2, $3 WHERE $4 NOT IN (SELECT COUNT(*) FROM accounts) RETURNING id',
            [profile.username.toLowerCase(), profile.id, 'github', options.userLimit],
            f.slot()
          );
        }
      }
    )
    .onSuccess(function (result) {
      passportDone(null, result.rows[0] ? {id : result.rows[0].id} : false);
    })
    .onError(function (err) {
      passportDone(err);
    });
  }
));

app = express();

if (process.env.NODE_ENV === 'production') {
  app.use(function (req, res, next) {
    res.setHeader('Strict-Transport-Security', 'max-age=8640000');

    if (req.get('x-forwarded-proto') !== 'https') {
      res.redirect(301, 'https://' + req.host + req.url);
    } else {
      next();
    }
  });
}

app
  .set('views', __dirname + '/../views')
  .set('view engine', 'ejs')
  .set('strict routing', true)
  .set('case sensitive routing', true)
  .use('/user', express.cookieParser())
  .use('/user', express.cookieSession({ secret: options.cookieSecret, cookie: { maxAge: 60 * 60 * 1000 }}))
  .use('/user', passport.initialize({ userProperty: 'passportUser' }))
  .use('/user', passport.session())
  .use(express.static(__dirname + '/../public'))
  .use(express.json())
  .use(express.urlencoded());


if (options.env === 'development') {
  try {
    DummyStrategy = require('passport-dummy').Strategy;
  } catch (e) {}
}
if (DummyStrategy) {
  passport.use(new DummyStrategy(
    function (passportDone) {
      var f = ffDb(function (client) {
        client.query('SELECT id FROM accounts LIMIT 1', [], f.slot());
      })
      .onSuccess(function (result) {
        passportDone(null, result.rows[0] ? {id : result.rows[0].id} : false);
      })
      .onError(function (err) {
        passportDone(err);
      });
    }
  ));
  app.get('/user/auth/dummy', passport.authenticate('dummy', {
    successRedirect: '/',
    failureRedirect: '/?error=login'
  }));
}

app.post('/user/auth/github', passport.authenticate('github'));
app.get('/user/auth/github/callback', passport.authenticate('github', {
  successRedirect: '/',
  failureRedirect: '/?error=login'
}));
app.get('/user/logout', function(req, res){
  req.logout();
  res.redirect('/');
});
app.get('/user/status', function (req, res) {
  var status = {
    loggedin : req.isAuthenticated()
  }, f;
  if (DummyStrategy) {
    status.dev = true;
  }
  if (status.loggedin) {
    res.send(status);
  } else {
    f = ffDb(function (client) {
      client.query('SELECT COUNT(*) AS registered FROM accounts', [], f.slot());
    }).onComplete(function (err, result) {
      if (!err && result.rows[0]) {
        status.accountsAvailable = options.userLimit - result.rows[0].registered;
      }
      res.send(status);
    });
  }
});
app.get('/user/sites', ensureAuthenticated, function (req, res) {
  var f = ffDb(function (client) {
    client.query('SELECT hostname FROM sites WHERE aid = $1', [req.passportUser.id], f.slot());
  })
  .onSuccess(function (result) {
    var sites = [];
    result.rows.forEach(function (row) {
      sites.push(row.hostname);
    });
    res.send({
      sites : sites
    });
  })
  .onError(function (err) {
    console.warn(err);
    console.log(err.stack);
    res.json(500, {
      error : true
    });
  });
});
app.post('/user/sites', ensureAuthenticated, function (req, res) {
  var hostname = req.body.hostname ? req.body.hostname.trim() : false
    , aid = req.passportUser.id;

  if (!hostname || !aid || !simpleHostnameValidation.test(hostname) || hostname.length > 255) {
    if (req.body.action && req.body.action === 'delete') {
      res.json(400, {
        error : true,
        errorType : 'validation'
      });
    } else {
      res.redirect('/?error=sites');
    }
  } else if (req.body.action && req.body.action === 'delete') {
    removeSite(res, aid, hostname);
  } else {
    addSite(res, aid, hostname);
  }
});

removeSite = function (res, aid, hostname) {
  var f = ffDb(function (client) {
    client.query('DELETE FROM sites WHERE aid = $1 AND hostname = $2', [aid, hostname], f.slot());
  })
  .onSuccess(function (result) {
    res.send({
      success : true,
      hostname : hostname
    });
  })
  .onError(function (err) {
    console.warn(err);
    console.log(err.stack);
    res.json(500, {
      error : true
    });
  });
};

addSite = function (res, aid, hostname) {
  var f = ffDb(function (client) {
    client.query('INSERT INTO sites (aid, hostname) VALUES ($1, $2)', [aid, hostname], f.slot());
  })
  .onSuccess(function (result) {
    res.redirect('/');
  })
  .onError(function (err) {
    console.warn(err);
    console.log(err.stack);
    res.redirect('/?error=sites');
  });
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
    callback(null, cleanedResult);
  })
  .onError(function (err) {
    callback(err);
  });
};

app.get('/api/embed', function (req, res) {
  getMentions(req.query.url, function (err, mentions) {
    if (err) {
      console.warn(err);
      console.log(err.stack);
      res.send(500);
    } else {
      res.setHeader('Content-Type', 'text/javascript');
      res.render('embed.ejs', { mentions: mentions });
    }
  })
});

app.get('/api/mentions', function (req, res) {
  getMentions(req.query.url, function (err, mentions) {
    if (err) {
      console.warn(err);
      console.log(err.stack);
      res.json(500, {
        error : true,
        message : 'An unexpected error occured'
      });
    } else {
      res.send(mentions);
    }
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

  sourceHost = url.parse(source).host;
  targetHost = url.parse(target).host;

  //TODO: Break the below up into methods to allow for more granular error handling

  f = ffDb(function (pgClient) {
      //TODO: Add caching of this data?
      client = pgClient;
      client.query('SELECT aid FROM sites WHERE hostname = $1', [targetHost], f.slot());
    },
    function (result) {
      if (!result.rows[0]) {
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

      var $ = cheerio.load(body);

      if (!$('a[href="' + target.replace('"', '%22') + '"]').length) {
        f.fail(new Error("Couldn't find a link from source to target"));
      } else {
        console.info('Microformatparsing');
        microformats.parseDom($, $.root(), {
          filters : ['h-entry']
        }, f.slot());
      }
    },
    function (data) {
      var url = source
        , entry = {};

      if (data.items.length) {
        url = data.items[0].properties.url[0];

        entry.name = data.items[0].properties.name[0];
        entry.published = Date.parse(data.items[0].properties.published[0]);
        entry.author = {
          name : data.items[0].properties.author[0].properties.name[0],
          photo : data.items[0].properties.author[0].properties.photo[0],
          url : data.items[0].properties.author[0].properties.url[0]
        };
      }

      client.query('INSERT INTO entries (url, data, raw) VALUES ($1, $2, $3) RETURNING id', [url, entry, data], f.slot());
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

server = http.createServer(app);
server.listen(process.env.PORT || 8080);

