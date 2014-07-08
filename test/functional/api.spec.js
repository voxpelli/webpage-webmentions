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

  describe('fetch mentions', function () {
    beforeEach(function () {
      return dbUtils.setupSampleMentions();
    });

    var matchMentions = function (done, err, res) {
      if (err) {
        return done(err);
      }

      res.body.should.be.an('array').of.length(4);

      res.body.should.have.deep.property('[0].name', null);
      res.body.should.have.deep.property('[0].url').that.match(/^https?:\/\/[^\/]+\//);
      res.body.should.have.deep.property('[0].author.name').that.is.a('string');

      res.body.should.have.deep.property('[0].author.photo')
        .that.is.a('string')
        .that.match(/^https?:\/\/[^\/]+\//);

      res.body.should.have.deep.property('[0].author.url')
        .that.is.a('string')
        .that.match(/^https?:\/\/[^\/]+\//);

      res.body.should.have.deep.property('[0].published')
        .that.is.a('number')
        .that.is.closeTo(Date.now(), 31 * 24 * 60 * 60 * 1000);

      done();
    };

    it('should return all matching mentions in an expected format', function (done) {
      request(app)
        .get('/api/mentions')
        .query({ url: 'http://example.org/foo' })
        .expect(200)
        .end(matchMentions.bind(undefined, done));
    });

    it('should return example mentions in an expected format', function (done) {
      request(app)
        .get('/api/mentions')
        .query({ example: 1 })
        .expect(200)
        .end(matchMentions.bind(undefined, done));
    });
  });

});
