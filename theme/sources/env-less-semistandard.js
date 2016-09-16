'use strict';

// Hack around the fact that the es6 environment isn't overrideable in ESLint

const config = Object.create(require('eslint-config-standard'));

config.env = {};

config.rules = Object.create(config.rules);

config.rules['semi'] = [2, 'always'];
config.rules['no-extra-semi'] = 2;
config.rules['semi-spacing'] = [2, { 'before': false, 'after': true }];

module.exports = config;
