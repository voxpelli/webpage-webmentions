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
  ensureAuthenticated,
  server,
  app,
  options;

options = {
  db : process.env.DATABASE_URL,
  cookieSecret : process.env.WEBMENTIONS_COOKIE_SECRET,
  hostname : process.env.WEBMENTIONS_HOSTNAME,
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

ensureAuthenticated = function (req, res, next) {
  if (req.isAuthenticated()) { return next(); }
  var err = new Error('Unauthorized');
  err.status = 401;
  next(err);
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
    var f = ff(
      function () {
        pg.connect(options.db, f.slotMulti(2));
      },
      function (client, done) {
        f.pass(client);
        f.onComplete(done);
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
            'INSERT INTO accounts (username, external_id, service) SELECT $1, $2, $3 WHERE 10 NOT IN (SELECT COUNT(*) FROM accounts) RETURNING id',
            [profile.username.toLowerCase(), profile.id, 'github'],
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

app = express()
  .use(express.favicon())
  .use('/user', express.cookieParser())
  .use('/user', express.cookieSession({ secret: options.cookieSecret, cookie: { maxAge: 60 * 60 * 1000 }}))
  .use('/user', passport.initialize({ userProperty: 'passportUser' }))
  .use('/user', passport.session())
  .use(express.static(__dirname + '/../public'))
  .use(express.bodyParser());

app.post('/user/auth/github', passport.authenticate('github'));
app.get('/user/auth/github/callback', passport.authenticate('github', {
  successRedirect: '/',
  failureRedirect: '/?error=login'
}));
app.get('/user/status', function (req, res) {
  res.send({
    loggedin : req.isAuthenticated()
  });
});
app.get('/user/sites', ensureAuthenticated, function (req, res) {
  var f = ff(
    function () {
      pg.connect(options.db, f.slotMulti(2));
    },
    function (client, done) {
      f.onComplete(done);
      client.query('SELECT hostname FROM sites WHERE aid = $1', [req.passportUser.id], f.slot());
    }
  )
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
//FIXME: Enable removal of sites!
app.post('/user/sites', ensureAuthenticated, function (req, res) {
  var hostname = req.body.hostname
    , f;

  //FIXME: Validate hostname!!!

  f = ff(
    function () {
      pg.connect(options.db, f.slotMulti(2));
    },
    function (client, done) {
      f.onComplete(done);
      client.query('INSERT INTO sites (aid, hostname) VALUES ($1, $2)', [req.passportUser.id, hostname], f.slot());
    }
  )
  .onSuccess(function (result) {
    res.redirect('/');
  })
  .onError(function (err) {
    console.warn(err);
    console.log(err.stack);
    res.redirect('/?error=sites');
  });
});

app.get('/api/embed', function (req, res) {
  var target = req.query.url, f;
  f = ff(this,
    function () {
      pg.connect(options.db, f.slotMulti(2));
    },
    function (client, done) {
      f.onComplete(done);
      client.query('SELECT data FROM entries AS e INNER JOIN mentions AS m ON e.id = m.eid WHERE m.url = $1', [target], f.slot());
    },
    function (result) {
      res.json(result.rows);
    }
  ).onError(function (err) {
    console.warn(err);
    console.log(err.stack);
    res.json(500, {
      error : true,
      message : 'An unexpected error occured'
    });
  });
});

app.post('/api/webmention', function (req, res, next) {
  var source, target, f, client;

  if (!req.body.source || !req.body.target) {
    res.json(400, {
      error : true,
      message : 'You need to specify both a "source" and a "target" URL'
    });
    return;
  }

  source = req.body.source;
  target = req.body.target;

  //TODO: Break the below up into methods to allow for more granular error handling

  f = ff(this,
    function () {
      pg.connect(options.db, f.slotMulti(2));
    },
    function (pgClient, done) {
      f.onComplete(done);
      client = pgClient;

      var targetHost = url.parse(target).host;

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
        entry.published = data.items[0].properties.published[0];
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

    var response = { error : true };

    if (err.status > 399 && err.status < 500) {
      response.message = err.message;
    }

    res.json(err.status || 500, response);
  });
});

server = http.createServer(app);
server.listen(process.env.PORT || 8080);

