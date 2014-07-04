/* jshint nonew:false */
/* global describe, beforeEach, it */

"use strict";

var chai = require('chai'),
  chaiAsPromised = require('chai-as-promised'),
  request = require('supertest'),
  nock = require('nock'),
  Promise = require('promise'),
  knex = require('../../lib/knex'),
  dbUtils = require('../db-utils');

chai.use(chaiAsPromised);
chai.should();

describe('WebMentionPing', function () {
  var app = require('../../lib/main'),
    WebMentionTemplates = require('webmention-testpinger').WebMentionTemplates,
    templateCollection = new WebMentionTemplates();

  beforeEach(function () {
    return dbUtils.clearDb()
      .then(dbUtils.setupSchema)
      .then(dbUtils.setupSampleData);
  });

  describe('parseSourcePage', function () {
    it('should handle the templates alright', function () {
      var templateCount, templateMocks = [];

      return templateCollection.getTemplateNames()
        .then(function (templateNames) {
          var templates = [];

          templateCount = templateNames.length;

          templateNames.forEach(function (name) {
            var resolveTemplate = templateCollection.getTemplate(name, 'http://example.org/foo').then(function (template) {
              templateMocks.push(
                nock('http://' + name + '.example.com')
                  .get('/')
                  .reply(200, function() {
                    return template;
                  })
              );
            }).then(function () {
              return name;
            });
            templates.push(resolveTemplate);
          });

          return Promise.all(templates);
        })
        .then(function (templateNames) {
          var requests = [];

          templateNames.forEach(function (name) {
            requests.push(new Promise(function (resolve, reject) {
              //TODO: Add a way to make this call syncronous
              request(app)
                .post('/api/webmention')
                .send({
                  source: 'http://' + name + '.example.com/',
                  target: 'http://example.org/foo'
                })
                .expect(202)
                .end(function (err) {
                  if (err) {
                    return reject(err);
                  }
                  resolve();
                });
            }));
          });

          return Promise.all(requests);
        })
        .then(function () {
          //TODO: Remake so that this delay isn't necessary
          return new Promise(function (resolve) {
            setTimeout(resolve, 500);
          });
        })
        .then(function () {
          return knex('entries').count('id').first();
        })
        .then(function (result) {
          templateMocks.forEach(function (templateMock) {
            templateMock.done();
          });
          result.count.should.be.a('string').and.equal(templateCount + '');
        });
    });
  });

});
