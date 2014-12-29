/* jshint nonew:false */
/* global describe, beforeEach, afterEach, it, -Promise */

"use strict";

var chai = require('chai'),
  chaiAsPromised = require('chai-as-promised'),
  request = require('supertest'),
  nock = require('nock'),
  Promise = require('promise'),
  _ = require('lodash'),
  mod_url = require('url'),
  knex = require('../../lib/knex'),
  dbUtils = require('../db-utils'),
  should;

chai.use(chaiAsPromised);
should = chai.should();

describe('WebMentionPing', function () {
  this.timeout(5000);

  var app = require('../../lib/main'),
    WebMentionTemplates = require('webmention-testpinger').WebMentionTemplates,
    templateCollection = new WebMentionTemplates();

  beforeEach(function () {
    return dbUtils.clearDb()
      .then(dbUtils.setupSchema)
      .then(dbUtils.setupSampleData);
  });

  afterEach(function () {
    nock.cleanAll();
  });

  describe('parseSourcePage', function () {
    it('should handle the templates alright', function () {
      var templateCount,
        templateMocks = [],
        mentionTargets = require('../template-mentions.json');

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
              request(app)
                .post('/api/webmention?sync')
                .send({
                  source: 'http://' + name + '.example.com/',
                  target: 'http://example.org/foo'
                })
                .expect(200)
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
          return knex('entries').select('url', 'type', 'data', 'raw');
        })
        .then(function (result) {
          templateMocks.forEach(function (templateMock) {
            templateMock.done();
          });

          result.should.be.an('array').be.of.length(templateCount);

          result.forEach(function (templateMention) {
            var target, name = mod_url.parse(templateMention.url).hostname.replace('.example.com', '');
            if (name && mentionTargets[name]) {
              target = _.cloneDeep(mentionTargets[name]);

              // Some templates don't have a published date, falling back to
              // Date.now() which messes up the deepEqual(). Working around it.
              if (target.published === undefined) {
                target.published = templateMention.data.published;
              }

              templateMention.data.should.deep.equal(target);

              if (target.interactionType) {
                should.equal(templateMention.type, target.interactionType);
              } else {
                should.not.exist(templateMention.type);
              }
            } else {
              // Uncomment to inspect new templates to easily add them to ../template-mentions.json
              // console.log(JSON.stringify(templateMention.data));
              // console.log(JSON.stringify(templateMention.raw));
            }
          });
        });
    });
    it('should handle pings asynchronously', function () {
      var templateMock;

      return templateCollection.getTemplateNames()
        .then(function (templateNames) {
          return templateNames[0];
        })
        .then(function (templateName) {
          return templateCollection.getTemplate(templateName, 'http://example.org/foo');
        })
        .then(function (template) {
          return nock('http://example.com/')
            .get('/')
            .reply(200, function() {
              return template;
            });
        })
        .then(function (mock) {
          templateMock = mock;

          return new Promise(function (resolve, reject) {
            request(app)
              .post('/api/webmention')
              .send({
                source: 'http://example.com/',
                target: 'http://example.org/foo'
              })
              .expect(202)
              .end(function (err) {
                if (err) {
                  return reject(err);
                }
                resolve();
              });
          });
        })
        .then(function () {
          return new Promise(function (resolve) {
            setTimeout(resolve, 100);
          });
        })
        .then(function () {
          return knex('entries').count('id').first();
        })
        .then(function (result) {
          templateMock.done();
          result.count.should.be.a('string').and.equal('1');
        });
    });
    it('should send a live update', function (done) {
      var templateMock;

      var updates = '';
      request(app)
        .get('/api/mentions/live?site=example.org')
        .query({ site: 'example.org' })
        .buffer(false)
        .end().req.on('response', function(res){
          res.on('data', function (data) {
            updates += data;
            if (data.indexOf('data:') === 0) {
              updates.should.contain('event: mention\ndata: {"url":"');
              done();
            }
          });
        });

      templateCollection.getTemplateNames()
        .then(function (templateNames) {
          return templateNames[0];
        })
        .then(function (templateName) {
          return templateCollection.getTemplate(templateName, 'http://example.org/foo');
        })
        .then(function (template) {
          return nock('http://example.com/')
            .get('/')
            .reply(200, function() {
              return template;
            });
        })
        .then(function (mock) {
          templateMock = mock;

          return new Promise(function (resolve, reject) {
            request(app)
              .post('/api/webmention?sync')
              .send({
                source: 'http://example.com/',
                target: 'http://example.org/foo'
              })
              .expect(202)
              .end(function (err) {
                if (err) {
                  return reject(err);
                }
                resolve();
              });
          });
        })
        .then(function () {
          return knex('entries').count('id').first();
        })
        .then(function (result) {
          templateMock.done();
          result.count.should.be.a('string').and.equal('1');
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

      res.body.should.have.deep.property('[0].targets')
        .that.is.an('array')
        .of.length.above(0);

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
