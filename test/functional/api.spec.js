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
            setTimeout(resolve, 1000);
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

    var matchMentions = function (done, count, err, res) {
      if (err) {
        return done(err);
      }

      res.body.should.be.an('array').of.length(count);

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
        .end(matchMentions.bind(undefined, done, 4));
    });

    it('should return example mentions in an expected format', function (done) {
      request(app)
        .get('/api/mentions')
        .query({ example: 1 })
        .expect(200)
        .end(matchMentions.bind(undefined, done, 4));
    });

    it('should allow matching based on hostname', function (done) {
      request(app)
        .get('/api/mentions')
        .query({ site: 'example.org' })
        .expect(200)
        .end(function (err, res) {
          if (err) {
            return done(err);
          }

          res.body.should.be.an('array').of.length(10);
          res.body.should.have.deep.property('[0].author.name');

          done();
        });
    });

    it('should ignore www. in hostname', function (done) {
      request(app)
        .get('/api/mentions')
        .query({ site: 'www.example.org' })
        .expect(200)
        .end(function (err, res) {
          if (err) {
            return done(err);
          }

          res.body.should.be.an('array').of.length(10);
          res.body.should.have.deep.property('[0].author.name');

          done();
        });
    });

    it('should allow matching based on path', function () {
      return Promise.all([
        new Promise(function (resolve, reject) {
          request(app)
            .get('/api/mentions')
            .query({ path: 'http://example.org/path' })
            .expect(200)
            .end(function (err, res) {
              if (err) {
                return reject(err);
              }

              res.body.should.be.an('array').of.length(9);
              res.body.should.have.deep.property('[0].author.name');

              resolve();
            });
        }),
        new Promise(function (resolve, reject) {
          request(app)
            .get('/api/mentions')
            .query({ path: 'http://example.org/foo' })
            .expect(200)
            .end(function (err, res) {
              if (err) {
                return reject(err);
              }

              res.body.should.be.an('array').of.length(4);
              res.body.should.have.deep.property('[0].author.name');

              resolve();
            });
        }),
        new Promise(function (resolve, reject) {
          // Test that the escaping works
          request(app)
            .get('/api/mentions')
            .query({ path: ['http://example.org/%h', 'http://example.org/p_th'] })
            .expect(200)
            .end(function (err, res) {
              if (err) {
                return reject(err);
              }

              res.body.should.be.an('array').of.length(0);

              resolve();
            });
        }),
      ]);
    });

    it('should ignore handle multiple matches', function (done) {
      request(app)
        .get('/api/mentions')
        .query({
          url: [
            'http://example.org/path/2',
            'http://example.org/path/4',
          ],
          path: 'http://example.org/foo'
        })
        .expect(200)
        .end(function (err, res) {
          if (err) {
            return done(err);
          }

          res.body.should.be.an('array').of.length(6);
          res.body.should.have.deep.property('[0].author.name');

          done();
        });
    });

    it('should allow matching based on path', function () {
      return new Promise(function (resolve, reject) {
        request(app)
          .get('/api/mentions')
          .query({ path: 'http://example.org/path' })
          .expect(200)
          .end(function (err, res) {
            if (err) {
              return reject(err);
            }

            res.body.should.be.an('array').and.satisfy(function (entries) {
              return false !== entries.reduce(function (previousValue, currentValue) {
                previousValue = previousValue.published || previousValue;
                if (previousValue === false || previousValue >= currentValue.published) {
                  return false;
                }
                return currentValue.published;
              });
            }, 'Should sort by publish date, starting with the oldest one');

            resolve();
          });
      });
    });

  });

});
