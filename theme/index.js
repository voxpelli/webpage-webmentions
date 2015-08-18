"use strict";

var _ = require('lodash');

var preprocessors = {};
var templates = {};
var theme;

var interactionPresentation = {
  'like': 'liked',
  'repost': 'reposted',
};

preprocessors.mentions = function (data, callback) {
  var locals = this.getLocals(theme);

  data.mentions.forEach(function (mention) {
    if (interactionPresentation[mention.type]) {
      mention.author.name = mention.author.name || 'Someone';
      mention.name = null;
      mention.summary = interactionPresentation[mention.type] + (mention.interactionTarget ? ' this' : ' something');
    } else {
      mention.author.name = mention.author.name || 'Anonymous';
    }
  });

  var targets;

  if (data.mentionsArguments.example) {
    targets = ['Example mentions'];
  } else {
    targets = [].concat(
      [].concat(data.mentionsArguments.url || []).map(function (value) {
        return 'Mentions of ' + locals.formatLink(value);
      }),
      [].concat(data.mentionsArguments.site || []).map(function (value) {
        return 'All mentions from site ' + locals.formatLink('http://' + value + '/', value);
      }),
      [].concat(data.mentionsArguments.path || []).map(function (value) {
        return 'All mentions matching path ' + _.escape(value);
      })
    );
  }

  data.targets = targets;
  delete data.mentionsArguments;

  callback(null, data);
};

var formatAttributes = function (attributes) {
  return _.map(attributes, function (value, key) {
    if (!value) { return ''; }
    return _.escape(key) + '="' + _.escape(_.isArray(value) ? value.join(' ') : value) + '"';
  }).join(' ');
};

var formatTag = function (tag, text, attributes) {
  if (!_.isString(text)) {
    attributes = text;
    text = '';
  }
  return '<' + tag + (attributes ? ' ' + formatAttributes(attributes) : '') + '>' + _.escape(text) + '</' + tag + '>';
};

var formatLink = function (href, text, attributes) {
  if (text && !_.isString(text)) {
    attributes = text;
    text = undefined;
  }
  if (!text) {
    text = href;
  }
  return formatTag('a', text, _.extend({}, attributes, { href }));
};

var locals = {
  formatAttributes,
  formatTag,
  formatLink,
  _,
};

theme = {
  templatePath : __dirname + '/templates/',
  publicPath : __dirname + '/public/',
  preprocessors : preprocessors,
  templates: templates,
  locals: locals,
};

module.exports = theme;
