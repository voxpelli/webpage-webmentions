'use strict';

const express = require('express');
const session = require('express-session');
const passport = require('passport');
const GitHubStrategy = require('passport-github').Strategy;
let DummyStrategy;
const knex = require('../knex');
const options = require('../config');
const { isWwwHost, simpleHostnameValidation } = require('../utils/url-tools');
const noop = function () {};
let ensureAuthenticated,
  removeSite,
  addSite;

// Configure passport

// TODO: Probably extend to what node-one-page has: https://github.com/voxpelli/node-one-page/blob/e8c62405522718fb29f742e0983dddb4a518876e/lib/utils/passportify.js#L75-L98
passport.serializeUser((user, done) => {
  done(null, user);
});
passport.deserializeUser((user, done) => {
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
    (accessToken, refreshToken, profile, passportDone) => {
      knex('accounts')
        .update({
          lastlogin: knex.fn.now(),
          username: profile.username.toLowerCase()
        }, 'id').where({
          external_id: profile.id,
          service: 'github'
        })
        .then(id => {
          if (id[0]) {
            return id[0];
          } else {
            return knex.raw(
              'INSERT INTO accounts (username, external_id, service, lastlogin, created) SELECT ?, ?, ?, now(), now() WHERE ? NOT IN (SELECT COUNT(*) FROM accounts) RETURNING id',
              [profile.username.toLowerCase(), profile.id, 'github', options.userLimit]
            ).then(result => result.rows[0] ? result.rows[0].id : undefined);
          }
        })
        .then(id => {
          passportDone(null, id ? { id } : false);
        })
        .catch(err => {
          console.error('Passport error', err);
          passportDone();
        });
    }
  ));
}

// Configure Dummy auth for development environments

if (options.env !== 'production') {
  try {
    DummyStrategy = require('@voxpelli/passport-dummy').Strategy;
  } catch (err) {}
}
if (DummyStrategy) {
  passport.use(new DummyStrategy(passportDone => {
    knex('accounts').first('id')
      .then(row => { passportDone(null, row ? { id: row.id } : false); })
      .catch(() => { passportDone(); });
  }));
}

// Utility functions

ensureAuthenticated = function (req, res, next) {
  if (req.isAuthenticated()) { return next(); }
  const err = new Error('Unauthorized');
  err.status = 401;
  next(err);
};

removeSite = function (res, aid, hostname) {
  knex('sites')
    .where({
      aid,
      hostname
    })
    .delete()
    .then(() => {
      res.send({
        success: true,
        hostname
      });
    })
    .catch(err => {
      console.warn(err);
      console.log(err.stack);
      res.status(500).json({
        error: true
      });
    });
};

addSite = function (res, aid, hostname) {
  if (isWwwHost.test(hostname)) {
    hostname = hostname.substr(4);
  }

  knex('sites')
    .insert({
      aid,
      hostname,
      created: knex.fn.now()
    })
    .then(() => {
      res.redirect('/');
    })
    .catch(err => {
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

router.get('/user/logout', (req, res) => {
  req.logout();
  res.redirect('/');
});
router.get('/user/status', (req, res) => {
  const status = {
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
      .then(rows => {
        status.accountsAvailable = options.userLimit - rows[0].registered;
        status.accountsTotal = options.userLimit;
      })
      .catch(noop)
      .then(() => {
        res.send(status);
      })
      .catch(err => { console.error('Encountered an error: ' + err.stack); });
  }
});
router.get('/user/sites/:site', ensureAuthenticated, (req, res) => {
  const hostname = req.params.site;

  if (!hostname || !simpleHostnameValidation.test(hostname)) {
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
      hostname
    })
  ])
    .then(queryResults => {
      const rows = queryResults.shift();
      const ownerMatch = queryResults.shift();
      const mentions = [];

      if (!ownerMatch) {
        res.status(404).json({
          error: true,
          errorType: 'notfound'
        });
      } else {
        rows.forEach(row => {
          mentions.push({
            source: row.source,
            target: row.target,
            data: row.data
          });
        });
        res.send({
          site: req.params.site,
          mentions
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
router.get('/user/sites', ensureAuthenticated, (req, res) => {
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
    .map(row => ({
      hostname: row.hostname,
      mentions: parseInt(row.mentions, 10)
    }))
    .then(sites => {
      res.send({ sites });
    })
    .catch(err => {
      console.warn(err);
      console.log(err.stack);
      res.status(500).json({
        error: true
      });
    });
});
router.post('/user/sites', ensureAuthenticated, (req, res) => {
  const hostname = req.body.hostname ? req.body.hostname.trim() : false;
  const aid = req.passportUser.id;

  if (!hostname || !aid || !simpleHostnameValidation.test(hostname) || hostname.length > 255) {
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
