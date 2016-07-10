'use strict';

if (!process.env.DATABASE_URL) {
  require('dotenv').load({
    silent: process.env.NODE_ENV === 'test'
  });
}

var config = {
  db: process.env.DATABASE_URL,
  env: process.env.NODE_ENV || 'production',
  port: process.env.PORT || 8080,
  https: process.env.WEBMENTIONS_HTTPS,
  cookieSecret: process.env.WEBMENTIONS_COOKIE_SECRET,
  hostname: process.env.WEBMENTIONS_HOSTNAME,
  userLimit: process.env.WEBMENTIONS_USER_LIMIT || 6,
  throttleSpan: (process.env.WEBMENTIONS_THROTTLE || 60) * 1000,
  github: {
    client_id: process.env.WEBMENTIONS_GITHUB_ID,
    client_secret: process.env.WEBMENTIONS_GITHUB_SECRET
  },
  dev: {
    throttling: process.env.WEBMENTIONS_DEV_THROTTLING,
    sigintCleanup: process.env.WEBMENTIONS_DEV_SIGINT_CLEANUP || false
  },
  version: require('../package.json').version
};

if (config.env === 'test') {
  config.db = process.env.DATABASE_TEST_URL || 'postgres://postgres@localhost/webmention_test';
}

if (config.https === undefined) {
  config.https = (config.env === 'production');
}

config.userAgent = 'A-WebMention-Endpoint/' + config.version + ' (https://github.com/voxpelli/webpage-webmentions)';

module.exports = config;
