/*jslint node: true, white: true, indent: 2 */

"use strict";

var express = require('express'),
  passport = require('passport'),
  GitHubStrategy = require('passport-github').Strategy,
  DummyStrategy,
  ffDb = require('../db'),
  options = require('../config'),
  simpleHostnameValidation = /^[\w\.-]*\w$/,
  ensureAuthenticated,
  removeSite,
  addSite;

// Configure passport

passport.serializeUser(function (user, done) {
  done(null, user);
});
passport.deserializeUser(function (user, done) {
  done(null, user);
});

// Configure GitHub

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
      passportDone();
    });
  }
));

// Configure Dummy auth for development environments

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
        passportDone();
      });
    }
  ));
}

// Utility functions

ensureAuthenticated = function (req, res, next) {
  if (req.isAuthenticated()) { return next(); }
  var err = new Error('Unauthorized');
  err.status = 401;
  next(err);
};

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

// Route setup

module.exports = function (app) {
  app
    .use('/user', express.cookieParser())
    .use('/user', express.cookieSession({ secret: options.cookieSecret, cookie: { maxAge: 60 * 60 * 1000 }}))
    .use('/user', passport.initialize({ userProperty: 'passportUser' }))
    .use('/user', passport.session())

  app.post('/user/auth/github', passport.authenticate('github'));
  app.get('/user/auth/github/callback', passport.authenticate('github', {
    successRedirect: '/',
    failureRedirect: '/?error=login'
  }));

  if (DummyStrategy) {
    app.get('/user/auth/dummy', passport.authenticate('dummy', {
      successRedirect: '/',
      failureRedirect: '/?error=login'
    }));
  }

  app.get('/user/logout', function(req, res){
    req.logout();
    res.redirect('/');
  });
  app.get('/user/status', function (req, res) {
    var status = {
      loggedin : req.isAuthenticated(),
      version : options.version
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
  app.get('/user/sites/:site', ensureAuthenticated, function (req, res) {
    var hostname = req.params.site;

    if (!hostname || !simpleHostnameValidation.test(hostname)) {
      res.json(404, {
        error : true,
        errorType : 'validation'
      });
      return;
    }

    var f = ffDb(function (client) {
      client.query('SELECT e.url AS source, m.url AS target, e.data FROM entries e INNER JOIN mentions m ON e.id = m.eid WHERE m.hostname = $1', [hostname], f.slot());
      client.query('SELECT aid FROM sites WHERE aid = $1 AND hostname = $2', [req.passportUser.id, hostname], f.slot());
    })
    .onSuccess(function (result, validationResult) {
      var mentions = [];

      if (!validationResult.rows[0]) {
        res.json(404, {
          error : true,
          errorType : 'notfound'
        });
      } else {
        result.rows.forEach(function (row) {
          mentions.push({
            source : row.source,
            target : row.target,
            data : row.data
          });
        });
        res.send({
          site : req.params.site,
          mentions : mentions
        });
      }
    })
    .onError(function (err) {
      console.warn(err);
      console.log(err.stack);
      res.json(500, {
        error : true
      });
    });
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
};
