'use strict';

const express = require('express');
const session = require('express-session');
const passport = require('passport');
const GitHubStrategy = require('passport-github').Strategy;
let DummyStrategy;
const knex = require('../knex');
const options = require('../config');
const urlTools = require('../utils/url-tools');
const noop = function () {};
let ensureAuthenticated,
  removeSite,
  addSite;

// Configure passport

// TODO: Probably extend to what node-one-page has: https://github.com/voxpelli/node-one-page/blob/e8c62405522718fb29f742e0983dddb4a518876e/lib/utils/passportify.js#L75-L98
passport.serializeUser(function (user, done) {
  done(null, user);
});
passport.deserializeUser(function (user, done) {
  done(null, user);
});

// Configure GitHub

if (options.github.client_id) {
  passport.use(new GitHubStrategy(
    {
      clientID: options.github.client_id,
      clientSecret: options.github.client_secret,
      callbackURL: (options.https ? 'https://' : 'http://') + options.hostname + '/user/auth/github/callback'
    },
    function (accessToken, refreshToken, profile, passportDone) {
      knex('accounts')
        .update({
          lastlogin: knex.fn.now(),
          username: profile.username.toLowerCase()
        }, 'id').where({
          external_id: profile.id,
          service: 'github'
        })
        .then(function (id) {
          if (id[0]) {
            return id[0];
          } else {
            return knex.raw(
              'INSERT INTO accounts (username, external_id, service, lastlogin, created) SELECT $1, $2, $3, now(), now() WHERE $4 NOT IN (SELECT COUNT(*) FROM accounts) RETURNING id',
              [profile.username.toLowerCase(), profile.id, 'github', options.userLimit]
            ).then(function (result) {
              return result.rows[0] ? result.rows[0].id : undefined;
            });
          }
        })
        .then(
          function (id) {
            passportDone(null, id ? {id: id} : false);
          },
          function (err) {
            console.error('Passport error', err);
            passportDone();
          }
        );
    }
  ));
}

// Configure Dummy auth for development environments

if (options.env !== 'production') {
  try {
    DummyStrategy = require('@voxpelli/passport-dummy').Strategy;
  } catch (e) {}
}
if (DummyStrategy) {
  passport.use(new DummyStrategy(
    function (passportDone) {
      knex('accounts').first('id').then(
        function (row) {
          passportDone(null, row ? {id: row.id} : false);
        },
        function () {
          passportDone();
        }
      );
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
  knex('sites')
    .where({
      aid: aid,
      hostname: hostname
    })
    .delete()
    .then(function () {
      res.send({
        success: true,
        hostname: hostname
      });
    })
    .then(undefined, function (err) {
      console.warn(err);
      console.log(err.stack);
      res.status(500).json({
        error: true
      });
    });
};

addSite = function (res, aid, hostname) {
  if (urlTools.isWwwHost.test(hostname)) {
    hostname = hostname.substr(4);
  }

  knex('sites')
    .insert({
      aid: aid,
      hostname: hostname,
      created: knex.fn.now()
    })
    .then(function () {
      res.redirect('/');
    })
    .then(undefined, function (err) {
      console.warn(err);
      console.log(err.stack);
      res.redirect('/?error=sites');
    });
};

// Route setup

const router = express.Router();

router.use('/user', session({
  secret: options.cookieSecret,
  resave: true,
  saveUninitialized: true,
  cookie: {
    maxAge: 60 * 60 * 1000
  }
}));
router.use('/user', passport.initialize({ userProperty: 'passportUser' }));
router.use('/user', passport.session());

router.post('/user/auth/github', passport.authenticate('github'));
router.get('/user/auth/github/callback', passport.authenticate('github', {
  successRedirect: '/',
  failureRedirect: '/?error=login'
}));

if (DummyStrategy) {
  router.get('/user/auth/dummy', passport.authenticate('dummy', {
    successRedirect: '/',
    failureRedirect: '/?error=login'
  }));
}

router.get('/user/logout', function (req, res) {
  req.logout();
  res.redirect('/');
});
router.get('/user/status', function (req, res) {
  var status = {
    loggedin: req.isAuthenticated(),
    version: options.version
  };
  if (DummyStrategy) {
    status.dev = true;
  }
  if (status.loggedin) {
    res.send(status);
  } else {
    knex('accounts').count('* as registered')
      .then(function (rows) {
        status.accountsAvailable = options.userLimit - rows[0].registered;
        status.accountsTotal = options.userLimit;
      })
      .then(undefined, noop)
      .then(function () {
        res.send(status);
      });
  }
});
router.get('/user/sites/:site', ensureAuthenticated, function (req, res) {
  var hostname = req.params.site;

  if (!hostname || !urlTools.simpleHostnameValidation.test(hostname)) {
    res.status(404).json(404, {
      error: true,
      errorType: 'validation'
    });
    return;
  }

  Promise.all([
    knex('entries')
      .select('entries.url as source', 'mentions.url as target', 'entries.data', 'mentions.removed')
      .innerJoin('mentions', 'entries.id', 'mentions.eid')
      .where('mentions.hostname', hostname),

    knex('sites').first('aid').where({
      aid: req.passportUser.id,
      hostname: hostname
    })
  ])
    .then(function (queryResults) {
      const rows = queryResults.shift();
      const ownerMatch = queryResults.shift();
      const mentions = [];

      if (!ownerMatch) {
        res.status(404).json({
          error: true,
          errorType: 'notfound'
        });
      } else {
        rows.forEach(function (row) {
          mentions.push({
            source: row.source,
            target: row.target,
            data: row.data
          });
        });
        res.send({
          site: req.params.site,
          mentions: mentions
        });
      }
    })
    .catch(err => {
      console.warn(err);
      console.log(err.stack);
      res.status(500).json({
        error: true
      });
    });
});
router.get('/user/sites', ensureAuthenticated, function (req, res) {
  knex('sites')
    .select('sites.hostname')
    .count('eid as mentions')
    .leftJoin('mentions', 'sites.hostname', 'mentions.hostname')
    .where('sites.aid', req.passportUser.id)
    .where(function () {
      this.where('mentions.removed', false);
      this.orWhereNull('mentions.removed');
    })
    .groupBy('sites.hostname')
    .map(function (row) {
      return {
        hostname: row.hostname,
        mentions: parseInt(row.mentions, 10)
      };
    })
    .then(function (sites) {
      res.send({ sites: sites });
    })
    .catch(err => {
      console.warn(err);
      console.log(err.stack);
      res.status(500).json({
        error: true
      });
    });
});
router.post('/user/sites', ensureAuthenticated, function (req, res) {
  const hostname = req.body.hostname ? req.body.hostname.trim() : false;
  const aid = req.passportUser.id;

  if (!hostname || !aid || !urlTools.simpleHostnameValidation.test(hostname) || hostname.length > 255) {
    if (req.body.action && req.body.action === 'delete') {
      res.status(400).json({
        error: true,
        errorType: 'validation'
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

module.exports = router;
