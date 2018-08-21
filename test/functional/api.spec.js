'use strict';

const mochaList = require('mocha').reporters.Base.list;
const mochaErrorLog = function (err, title) {
  mochaList([{
    err,
    fullTitle: () => title || 'Untitled'
  }]);
};

const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');
const request = require('supertest');
const nock = require('nock');
const sinon = require('sinon');
const cloneDeep = require('lodash.clonedeep');
const urlModule = require('url');
const knex = require('../../lib/knex');
const dbUtils = require('../db-utils');

chai.use(chaiAsPromised);
const should = chai.should();

describe('WebMention API', function () {
  this.timeout(7000);

  let app;

  const Entry = require('../../lib/classes/entry');
  const WebMentionTemplates = require('webmention-testpinger').WebMentionTemplates;
  const microformatsVersion = require('@voxpelli/metadataparser-mf2').versions;
  const templateCollection = new WebMentionTemplates();

  let waitingForNotifications;

  const waitForNotification = function (limit) {
    if (!Entry.prototype._notify.restore) {
      let count = 0;

      sinon.stub(Entry.prototype, '_notify').callsFake(() => {
        count += 1;
        waitingForNotifications.reduce(function (position, options) {
          var limit = position + options.limit;
          if (count === limit) {
            options.callback();
          }
          return limit;
        }, 0);
      });
    }

    const notificationPromise = new Promise(function (resolve) {
      waitingForNotifications.push({
        limit: limit === undefined ? 1 : limit,
        callback: resolve
      });
    });

    return function () {
      return notificationPromise;
    };
  };

  before(() => {
    return dbUtils.clearDb()
      .then(dbUtils.setupSchema)
      .then(() => {
        const main = require('../../lib/main');

        app = main.app;

        return new Promise(resolve => setTimeout(resolve, 1000));
      });
  });

  beforeEach(() => {
    nock.cleanAll();
    nock.disableNetConnect();
    nock.enableNetConnect('127.0.0.1');

    waitingForNotifications = [];

    return dbUtils.clearDb()
      .then(dbUtils.setupSchema)
      .then(dbUtils.setupSampleData);
  });

  afterEach(function () {
    sinon.verifyAndRestore();

    if (!nock.isDone()) {
      throw new Error('pending mocks: ' + nock.pendingMocks());
    }
  });

  describe('parseSourcePage', function () {
    it('should handle the templates alright', function () {
      const mentionTargets = require('../template-mentions.json');
      const templateMocks = [];
      let templateCount;

      return templateCollection.getTemplateNames()
        .then(function (templateNames) {
          var templates = [];

          templateCount = templateNames.length;

          templateNames.forEach(function (name) {
            var resolveTemplate = templateCollection.getTemplate(name, 'http://example.org/foo').then(function (template) {
              templateMocks.push(
                nock('http://' + name + '.example.com')
                  .get('/')
                  .reply(200, function () {
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

          return Promise.all(requests).then(waitForNotification(templateNames.length));
        })
        .then(function () {
          return knex('entries').select('url', 'type', 'data', 'raw', 'mfversion');
        })
        .then(function (result) {
          templateMocks.forEach(function (templateMock) {
            templateMock.done();
          });

          result.should.be.an('array').be.of.length(templateCount);

          return Promise.all(result.map(templateMention => Promise.resolve().then(() => {
            const name = urlModule.parse(templateMention.url).hostname.replace('.example.com', '');

            if (name && mentionTargets[name]) {
              let target = cloneDeep(mentionTargets[name]);

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

              templateMention.mfversion.should.equal('mf2::' + microformatsVersion.version + '::' + microformatsVersion.microformatsVersion);
            } else {
              // Uncomment to inspect new templates to easily add them to ../template-mentions.json
              // console.log(JSON.stringify(templateMention.data));
              // console.log(JSON.stringify(templateMention.raw));
            }
          }).catch(err => {
            mochaErrorLog(err, 'Template error');
            throw err;
          })));
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
            .reply(200, function () {
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
        .then(waitForNotification())
        .then(function () {
          return Promise.all([
            knex('entries').count('id').first(),
            knex('mentions').count('eid').first()
          ]);
        })
        .then(function (result) {
          templateMock.done();
          result.should.deep.equal([
            {count: '1'},
            {count: '1'}
          ]);
        });
    });

    it('should send a live update', function (done) {
      var templateMock, result;

      var updates = '';
      request(app)
        .get('/api/mentions/live?site=example.org')
        .query({ site: 'example.org' })
        .buffer(false)
        .end().req.on('response', function (res) {
          var listener = function (data) {
            updates += data;
            if (data.indexOf('data:') === 0) {
              updates.should.contain('event: mention\ndata: {"url":"');
              res.removeListener('data', listener);
              result
                .then(function () {
                  return knex('entries').count('id').first();
                })
                .then(function (result) {
                  templateMock.done();
                  result.count.should.be.a('string').and.equal('1');
                })
                .then(function () {
                  done();
                })
                .catch(done);
            }
          };
          res.on('data', listener);
        });

      result = templateCollection.getTemplateNames()
        .then(function (templateNames) {
          return templateNames[0];
        })
        .then(function (templateName) {
          return templateCollection.getTemplate(templateName, 'http://example.org/foo');
        })
        .then(function (template) {
          return nock('http://example.com/')
            .get('/')
            .reply(200, function () {
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
        });
    });

    it('should handle multiple mentions', function () {
      var templateMock;

      templateMock = nock('http://example.com')
        .get('/')
        .times(2)
        .reply(200, function () {
          return '<div class="h-entry">' +
            '<a href="http://example.org/foo">First</a>' +
            '<a href="http://example.org/bar">second</a>' +
          '</div>';
        });

      return Promise.all(
        [
          'http://example.org/foo',
          'http://example.org/bar'
        ].map(function (target) {
          return new Promise(function (resolve, reject) {
            request(app)
              .post('/api/webmention')
              .send({
                source: 'http://example.com/',
                target: target
              })
              .expect(202)
              .end(function (err) {
                if (err) {
                  return reject(err);
                }
                resolve();
              });
          }).then(waitForNotification());
        })
      )
        .then(function () {
          return knex('mentions').count('url').first();
        })
        .then(function (result) {
          templateMock.done();
          result.count.should.be.a('string').and.equal('2');
        });
    });

    it('should update all existing source mentions on valid ping', function () {
      var templateMock;

      templateMock = nock('http://example.com')
        .get('/')
        .once()
        .reply(200, function () {
          return '<div class="h-entry">' +
            '<a href="http://example.org/foo">First</a>' +
            '<a href="http://example.org/bar">second</a>' +
          '</div>';
        })
        .get('/')
        .once()
        .reply(200, function () {
          return '<div class="h-entry">' +
            '<a class="u-like-of" href="http://example.org/foo">First</a>' +
            '<a href="http://example.org/bar">second</a>' +
          '</div>';
        });

      return [
        'http://example.org/foo',
        'http://example.org/bar'
      ].reduce(
        (promiseChain, target) => promiseChain.then(() =>
          new Promise((resolve, reject) => {
            request(app)
              .post('/api/webmention')
              .send({
                source: 'http://example.com/',
                target: target
              })
              .expect(202)
              .end(err => {
                if (err) { return reject(err); }
                resolve();
              });
          })
        ).then(waitForNotification()),
        Promise.resolve()
      )
        .then(() => { templateMock.done(); })
        .then(() => knex('mentions').select().orderBy('url', 'desc'))
        .then(result => {
          result.should.be.an('array').with.a.lengthOf(2);

          result.should.have.nested.property('[0].url', 'http://example.org/foo');
          result.should.have.nested.property('[0].interaction', true);
          result.should.not.have.nested.property('[0].updated', null);
          result.should.have.nested.property('[0].removed', false);

          result.should.have.nested.property('[1].url', 'http://example.org/bar');
          result.should.have.nested.property('[1].interaction', false);
          result.should.have.nested.property('[1].updated', null);
          result.should.have.nested.property('[1].removed', false);
        })
        .then(() => knex('entries').select())
        .then(result => {
          result.should.be.an('array').with.a.lengthOf(1);

          result.should.have.nested.property('[0].url', 'http://example.com/');
          result.should.have.nested.property('[0].published').that.is.a('date');
          result.should.have.nested.property('[0].updated').that.is.a('date').that.not.equals(result[0].published);
          result.should.have.nested.property('[0].type', 'like');
          result.should.have.nested.property('[0].data.interactionType', 'like');
          result.should.have.nested.property('[0].data.interactions').that.deep.equals(['http://example.org/foo']);
        });
    });

    it('should update on repeated ping', function () {
      var templateMock1, templateMock2;

      templateMock1 = nock('http://example.com')
        .get('/')
        .times(1)
        .reply(200, function () {
          return '<div class="h-entry">' +
            '<a href="http://example.org/foo">First</a>' +
          '</div>';
        });

      templateMock2 = nock('http://example.com')
        .get('/')
        .times(1)
        .reply(200, function () {
          return '<div class="h-entry">' +
            '<a class="u-like-of" href="http://example.org/foo">First</a>' +
          '</div>';
        });

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
      })
        .then(waitForNotification())
        .then(function () {
          templateMock1.done();
          return knex('entries').select();
        })
        .then(function (result) {
          result.should.be.an('array').with.a.lengthOf(1);
          result.should.have.nested.property('[0].published').that.is.a('date');
          result.should.have.nested.property('[0].updated').that.is.a('date');
          result.should.have.nested.property('[0].type', null);
          result.should.not.have.nested.property('[0].data.interactionType');
          result.should.not.have.nested.property('[0].data.interactions');

          result[0].published.valueOf()
            .should.equal(result[0].updated.valueOf());
        })
        .then(function () {
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
        .then(waitForNotification())
        .then(function () {
          templateMock2.done();
          return knex('entries').select();
        })
        .then(function (result) {
          result.should.be.an('array').with.a.lengthOf(1);
          result.should.have.nested.property('[0].published').that.is.a('date');
          result.should.have.nested.property('[0].updated').that.is.a('date').that.not.equals(result[0].published);
          result.should.have.nested.property('[0].type', 'like');
          result.should.have.nested.property('[0].data.interactionType', 'like');
          result.should.have.nested.property('[0].data.interactions').that.deep.equals(['http://example.org/foo']);
        });
    });

    it('should update remove all outdated source mentions on valid ping', function () {
      var templateMock1, templateMock2;

      templateMock1 = nock('http://example.com')
        .get('/')
        .times(1)
        .reply(200, function () {
          return '<div class="h-entry">' +
            '<a href="http://example.org/foo">First</a>' +
          '</div>';
        });

      templateMock2 = nock('http://example.com')
        .get('/')
        .times(1)
        .reply(200, function () {
          return '<div class="h-entry">' +
            '<a href="http://example.org/bar">second</a>' +
          '</div>';
        });

      return [
        'http://example.org/foo',
        'http://example.org/bar'
      ].reduce(
        (promiseChain, target) => promiseChain.then(() =>
          new Promise((resolve, reject) => {
            request(app)
              .post('/api/webmention')
              .send({
                source: 'http://example.com/',
                target: target
              })
              .expect(202)
              .end(err => {
                if (err) { return reject(err); }
                resolve();
              });
          })
        ).then(waitForNotification()),
        Promise.resolve()
      )
        .then(() => knex('mentions').select().orderBy('url', 'desc'))
        .then(result => {
          templateMock1.done();
          templateMock2.done();

          result.should.be.an('array').with.a.lengthOf(2);

          result.should.have.nested.property('[0].url', 'http://example.org/foo');
          result.should.have.nested.property('[0].interaction', false);
          result.should.not.have.nested.property('[0].updated', null);
          result.should.have.nested.property('[0].removed', true);

          result.should.have.nested.property('[1].url', 'http://example.org/bar');
          result.should.have.nested.property('[1].interaction', false);
          result.should.have.nested.property('[1].updated', null);
          result.should.have.nested.property('[1].removed', false);
        });
    });

    it('should properly handle pings of site that returns 404:s');

    it('should fetch comments found on mentions', function () {
      var templateMock;

      templateMock = nock('http://example.com')
        .get('/')
        .once()
        .reply(200, function () {
          return '<div class="h-entry">' +
            '<a href="http://example.org/foo">First</a>' +
            '<a class="u-comment" href="http://example.com/foo">First</a>' +
          '</div>';
        })
        .get('/foo')
        .once()
        .reply(200, function () {
          return '<div class="h-entry">' +
            '<a href="http://example.com/">First</a>' +
          '</div>';
        });

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
      })
        .then(waitForNotification(2))
        .then(function () {
          return Promise.all([
            knex('entries').count('id').first(),
            knex('mentions').count('eid').first()
          ]);
        })
        .then(function (result) {
          templateMock.done();
          result.should.deep.equal([
            {count: '2'},
            {count: '2'}
          ]);
        });
    });

    it('should fetch responses-links found on mentions', function () {
      var templateMock;

      templateMock = nock('http://example.com')
        .get('/')
        .once()
        .reply(200, function () {
          return '<div class="h-entry">' +
            '<a href="http://example.org/foo">First</a>' +
            '<a class="u-responses" href="http://example.com/bar">First</a>' +
          '</div>';
        })
        .get('/bar')
        .once()
        .reply(200, function () {
          return '<div class="h-entry">' +
            '<a class="u-url" href="http://example.com/foo">First</a>' +
          '</div>';
        })
        .get('/foo')
        .once()
        .reply(200, function () {
          return '<div class="h-entry">' +
            '<a href="http://example.com/">First</a>' +
          '</div>';
        });

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
      })
        .then(waitForNotification(2))
        .then(function () {
          return Promise.all([
            knex('entries').count('id').first(),
            knex('mentions').count('eid').first()
          ]);
        })
        .then(function (result) {
          templateMock.done();
          result.should.deep.equal([
            {count: '2'},
            {count: '2'}
          ]);
        });
    });

    it('should fetch and ping upstream salmention targets of mention', function () {
      var templateMock = nock('http://example.com')
        .get('/')
        .once()
        .reply(200, function () {
          return '<div class="h-entry">' +
            '<a href="http://example.net/foo">First</a>' +
          '</div>';
        });

      var targetMock = nock('http://example.net')
        .get('/foo')
        .once()
        .reply(200, function () {
          return '<div class="h-entry">' +
            '<a class="u-in-reply-to" href="http://example.net/bar">First</a>' +
          '</div>';
        })
        .get('/bar')
        .once()
        .reply(200, function () {
          return '<html><head>' +
            '<link rel="webmention" href="http://webmention.example.com/ping" />' +
          '</head><body>' +
              '<div class="h-entry">a simple linkless entry</div>' +
          '</html>';
        });

      var pingMock = nock('http://webmention.example.com')
        .post('/ping', {
          source: 'http://example.net/foo',
          target: 'http://example.net/bar'
        })
        .once()
        .reply(202);

      return new Promise(function (resolve, reject) {
        request(app)
          .post('/api/webmention')
          .send({
            source: 'http://example.com/',
            target: 'http://example.net/foo'
          })
          .expect(202)
          .end(function (err) {
            if (err) {
              return reject(err);
            }
            resolve();
          });
      })
        .then(waitForNotification(3))
        .then(function () {
        // TODO: Improve – relyng on timers in tests are pretty fragile
          return new Promise(function (resolve) {
            setTimeout(resolve, 300);
          });
        })
        .then(function () {
          return Promise.all([
            knex('entries').count('id').first(),
            knex('mentions').count('eid').first()
          ]);
        })
        .then(function (result) {
          templateMock.done();
          targetMock.done();
          pingMock.done();
          result.should.deep.equal([
            {count: '3'},
            {count: '1'}
          ]);
        });
    });

    it('should fetch and ping upstream salmention targets on downstream mention', function () {
      var templateMock = nock('http://example.com')
        .get('/')
        .once()
        .reply(200, function () {
          return '<div class="h-entry">' +
            '<a href="http://example.net/foo">First</a>' +
            '<a class="u-comment" href="http://example.com/foo">First</a>' +
          '</div>';
        })
        .get('/foo')
        .once()
        .reply(200, function () {
          return '<div class="h-entry">' +
            '<a href="http://example.com/">First</a>' +
          '</div>';
        });

      var targetMock = nock('http://example.net')
        .get('/foo')
        .twice() // TODO: Should be .once() really
        .reply(200, function () {
          return '<div class="h-entry">' +
            '<a class="u-in-reply-to" href="http://example.net/bar">First</a>' +
          '</div>';
        })
        .get('/bar')
        .twice() // TODO: Should be .once() really
        .reply(200, function () {
          return '<html><head>' +
            '<link rel="webmention" href="http://webmention.example.com/ping" />' +
          '</head><body>' +
              '<div class="h-entry">a simple linkless entry</div>' +
          '</html>';
        });

      var pingMock = nock('http://webmention.example.com')
        .post('/ping', {
          source: 'http://example.net/foo',
          target: 'http://example.net/bar'
        })
        .twice() // TODO: Should be .once() really
        .reply(202);

      return new Promise(function (resolve, reject) {
        request(app)
          .post('/api/webmention')
          .send({
            source: 'http://example.com/',
            target: 'http://example.net/foo'
          })
          .expect(202)
          .end(function (err) {
            if (err) {
              return reject(err);
            }
            resolve();
          });
      })
        .then(waitForNotification(4))
        .then(function () {
        // TODO: Improve – relyng on timers in tests are pretty fragile
          return new Promise(function (resolve) {
            setTimeout(resolve, 300);
          });
        })
        .then(function () {
          return Promise.all([
            knex('entries').count('id').first(),
            knex('mentions').count('eid').first()
          ]);
        })
        .then(function (result) {
          templateMock.done();
          targetMock.done();
          pingMock.done();
          result.should.deep.equal([
            {count: '4'},
            {count: '2'}
          ]);
        });
    });

    it('should fetch and ping upstream salmention person tags', function () {
      var templateMock = nock('http://example.com')
        .get('/')
        .once()
        .reply(200, function () {
          return '<div class="h-entry">' +
            '<a href="http://example.net/foo">First</a>' +
          '</div>';
        });

      var targetMock = nock('http://example.net')
        .get('/foo')
        .once()
        .reply(200, function () {
          return '<div class="h-entry">' +
            '<a href="http://example.net/bar" class="u-category h-card">Bob Smith</a>' +
          '</div>';
        })
        .get('/bar')
        .once()
        .reply(200, function () {
          return '<html><head>' +
            '<link rel="webmention" href="http://webmention.example.com/ping" />' +
          '</head><body>' +
              '<div class="h-entry">a simple linkless entry</div>' +
          '</html>';
        });

      var pingMock = nock('http://webmention.example.com')
        .post('/ping', {
          source: 'http://example.net/foo',
          target: 'http://example.net/bar'
        })
        .once()
        .reply(202);

      return new Promise(function (resolve, reject) {
        request(app)
          .post('/api/webmention')
          .send({
            source: 'http://example.com/',
            target: 'http://example.net/foo'
          })
          .expect(202)
          .end(function (err) {
            if (err) {
              return reject(err);
            }
            resolve();
          });
      })
        .then(waitForNotification(3))
        .then(function () {
        // TODO: Improve – relyng on timers in tests are pretty fragile
          return new Promise(function (resolve) {
            setTimeout(resolve, 300);
          });
        })
        .then(function () {
          return Promise.all([
            knex('entries').count('id').first(),
            knex('mentions').count('eid').first()
          ]);
        })
        .then(function (result) {
          templateMock.done();
          targetMock.done();
          pingMock.done();
          result.should.deep.equal([
            {count: '3'},
            {count: '1'}
          ]);
        });
    });

    it('should reject malformed source URL:s', function () {
      return new Promise(function (resolve, reject) {
        request(app)
          .post('/api/webmention')
          .send({
            source: 'invalid',
            target: 'http://example.org/foo'
          })
          .expect(400)
          .end(err => err ? reject(err) : resolve());
      });
    });

    it('should reject malformed target URL:s', function () {
      return new Promise(function (resolve, reject) {
        request(app)
          .post('/api/webmention')
          .send({
            source: 'http://example.org/foo',
            target: 'invalid'
          })
          .expect(400)
          .end(err => err ? reject(err) : resolve());
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

      res.body.should.have.nested.property('[0].name', null);
      res.body.should.have.nested.property('[0].url').that.match(/^https?:\/\/[^/]+\//);
      res.body.should.have.nested.property('[0].author.name').that.is.a('string');

      res.body.should.have.nested.property('[0].author.photo')
        .that.is.a('string')
        .that.match(/^https?:\/\/[^/]+\//);

      res.body.should.have.nested.property('[0].author.url')
        .that.is.a('string')
        .that.match(/^https?:\/\/[^/]+\//);

      res.body.should.have.nested.property('[0].published')
        .that.is.a('number')
        .that.is.closeTo(Date.now(), 31 * 24 * 60 * 60 * 1000);

      res.body.should.have.nested.property('[0].targets')
        .that.is.an('array')
        .of.length.above(0);

      res.body.should.have.nested.property('[0].type')
        .that.is.a('string')
        .that.match(/^(like|repost|reply|mention)$/);

      res.body.should.have.nested.property('[0].interactions')
        .that.is.an('array');

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
        .end(matchMentions.bind(undefined, done, 14));
    });

    // Test the resolveDerivedData() method and use
    it.skip('should derive interaction target status correctly');

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
          res.body.should.have.nested.property('[0].author.name');

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
          res.body.should.have.nested.property('[0].author.name');

          done();
        });
    });

    it('should allow matching based on path', function () {
      return [
        function () {
          return new Promise(function (resolve, reject) {
            request(app)
              .get('/api/mentions')
              .query({ path: 'http://example.org/path' })
              .expect(200)
              .end(function (err, res) {
                if (err) {
                  return reject(err);
                }

                res.body.should.be.an('array').of.length(9);
                res.body.should.have.nested.property('[0].author.name');

                resolve();
              });
          });
        },
        function () {
          return new Promise(function (resolve, reject) {
            request(app)
              .get('/api/mentions')
              .query({ path: 'http://example.org/foo' })
              .expect(200)
              .end(function (err, res) {
                if (err) {
                  return reject(err);
                }

                res.body.should.be.an('array').of.length(4);
                res.body.should.have.nested.property('[0].author.name');

                resolve();
              });
          });
        },
        function () {
          return new Promise(function (resolve, reject) {
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
          });
        }
      ].reduce((result, next) => result.then(next), Promise.resolve());
    });

    it('should ignore handle multiple matches', function (done) {
      request(app)
        .get('/api/mentions')
        .query({
          url: [
            'http://example.org/path/2',
            'http://example.org/path/4'
          ],
          path: 'http://example.org/foo'
        })
        .expect(200)
        .end(function (err, res) {
          if (err) {
            return done(err);
          }

          res.body.should.be.an('array').of.length(6);
          res.body.should.have.nested.property('[0].author.name');

          done();
        });
    });

    it('should sort the result', function () {
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
              return entries.reduce(function (previousValue, currentValue) {
                previousValue = previousValue.published || previousValue;
                if (previousValue === false || previousValue >= currentValue.published) {
                  return false;
                }
                return currentValue.published;
              }) !== false;
            }, 'Should sort by publish date, starting with the oldest one');

            resolve();
          });
      });
    });

    it('should sort the result reversed when requested to', function () {
      return new Promise(function (resolve, reject) {
        request(app)
          .get('/api/mentions')
          .query({ path: 'http://example.org/path', sort: 'desc' })
          .expect(200)
          .end(function (err, res) {
            if (err) {
              return reject(err);
            }

            res.body.should.be.an('array').and.satisfy(function (entries) {
              return entries.reduce(function (previousValue, currentValue) {
                previousValue = previousValue.published || previousValue;
                if (previousValue !== undefined && (previousValue === false || previousValue <= currentValue.published)) {
                  return false;
                }
                return currentValue.published;
              }) !== false;
            }, 'Should sort by publish date, starting with the newest one');

            resolve();
          });
      });
    });
  });

  describe('live updates', function () {
    it.skip('should return data in an expected format');

    // Test the resolveDerivedData() method and use
    it.skip('should derive interaction target status correctly');
  });
});
