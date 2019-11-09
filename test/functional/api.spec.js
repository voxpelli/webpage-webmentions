// @ts-check
/// <reference types="node" />
/// <reference types="mocha" />
/// <reference types="chai" />
/// <reference types="sinon" />
/// <reference types="supertest" />

'use strict';

const mochaList = require('mocha').reporters.Base.list;

/**
 * @param {Error} err
 * @param {string} title
 */
const mochaErrorLog = (err, title) => {
  // @ts-ignore
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
const VError = require('verror');

const knex = require('../../lib/knex');
const dbUtils = require('../db-utils');

chai.use(chaiAsPromised);
const should = chai.should();

const isSinonStub = (value) => !!(value && value.restore && value.restore.sinon);

/**
 * @param {number} timeout
 * @returns {Promise<void>}
 */
const promisedWait = (timeout) => new Promise(resolve => setTimeout(resolve, timeout));

describe('parseSourcePage', function () {
  this.timeout(15000);

  let app;

  const Entry = require('../../lib/classes/entry');
  const WebMentionTemplates = require('webmention-testpinger').WebMentionTemplates;
  const microformatsVersion = require('@voxpelli/metadataparser-mf2').versions;
  const templateCollection = new WebMentionTemplates();

  /** @type {{limit: number, callback: () => void}[]} */
  let waitingForNotifications;

  /**
   * @param {number} [limit]
   * @returns {Promise<void>}
   */
  const asyncNotification = async (limit) => {
    if (!isSinonStub(Entry.prototype._notify)) {
      let count = 0;

      sinon.stub(Entry.prototype, '_notify').callsFake(async () => {
        count += 1;
        waitingForNotifications.reduce((position, options) => {
          const limit = position + options.limit;
          if (count === limit) {
            options.callback();
          }
          return limit;
        }, 0);
      });
    }

    /** @type {Promise<void>} */
    const notificationPromise = new Promise(resolve => {
      waitingForNotifications.push({
        limit: limit === undefined ? 1 : limit,
        callback: resolve
      });
    });

    return notificationPromise;
  };

  before(async () => {
    await dbUtils.clearDb();
    await dbUtils.setupSchema();

    const main = require('../../lib/main');

    app = main.app;

    await promisedWait(1000);
  });

  beforeEach(async () => {
    nock.cleanAll();
    nock.disableNetConnect();
    nock.enableNetConnect('127.0.0.1');

    waitingForNotifications = [];

    await dbUtils.clearDb();
    await dbUtils.setupSchema();
    await dbUtils.setupSampleData();
  });

  afterEach(() => {
    sinon.verifyAndRestore();

    if (!nock.isDone()) {
      throw new Error('pending mocks: ' + nock.pendingMocks());
    }
  });

  describe('basic', () => {
    it('should handle the templates alright', async () => {
      const mentionTargets = require('../template-mentions.json');
      const templateMocks = [];

      const templateNames = await templateCollection.getTemplateNames();
      const templateCount = templateNames.length;

      for (const name of templateNames) {
        const template = await templateCollection.getTemplate(name, 'http://example.org/foo');

        templateMocks.push(
          nock('http://' + name + '.example.com')
            .get('/')
            .reply(200, () => template)
        );
      }

      const requests = [];

      for (const name of templateNames) {
        requests.push(
          request(app)
            .post('/api/webmention')
            .send({
              source: 'http://' + name + '.example.com/',
              target: 'http://example.org/foo'
            })
            .expect(202)
        );
      }

      await Promise.all(requests);

      await asyncNotification(templateNames.length);

      for (const mock of templateMocks) {
        mock.done();
      }

      const result = await knex('entries').select('url', 'type', 'data', 'raw', 'mfversion');

      result.should.be.an('array').be.of.length(templateCount);

      for (const templateMention of result) {
        const name = urlModule.parse(templateMention.url).hostname.replace('.example.com', '');

        if (name && mentionTargets[name]) {
          try {
            const target = cloneDeep(mentionTargets[name]);
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
          } catch (err) {
            mochaErrorLog(err, 'Template error');
            throw err;
          }
        } else {
          // Uncomment to inspect new templates to easily add them to ../template-mentions.json
          // console.log(JSON.stringify(templateMention.data));
          // console.log(JSON.stringify(templateMention.raw));
        }
      }
    });

    it('should handle pings asynchronously', async () => {
      const [templateName] = await templateCollection.getTemplateNames();
      const template = await templateCollection.getTemplate(templateName, 'http://example.org/foo');
      const mock = nock('http://example.com/')
        .get('/')
        .reply(200, () => template);

      await request(app)
        .post('/api/webmention')
        .send({
          source: 'http://example.com/',
          target: 'http://example.org/foo'
        })
        .expect(202);

      await asyncNotification();

      const result = await Promise.all([
        knex('entries').count('id').first(),
        knex('mentions').count('eid').first()
      ]);

      mock.done();

      result.should.deep.equal([
        { count: '1' },
        { count: '1' }
      ]);
    });

    it('should send a live update', done => {
      let templateMock;

      let updates = '';

      request(app)
        .get('/api/mentions/live?site=example.org')
        .query({ site: 'example.org' })
        .buffer(false)
        .end().on('response', res => {
          const listener = (data) => {
            updates += data;
            if (data.indexOf('data:') === 0) {
              updates.should.contain('event: mention\ndata: {"url":"');
              res.removeListener('data', listener);
              result
                .then(async () => {
                  const dbResult = await knex('entries').count('id').first();
                  templateMock.done();
                  dbResult.count.should.be.a('string').and.equal('1');
                  done();
                })
                .catch(err => { done(new VError(err, 'DB call failed')); });
            }
          };
          res.on('data', listener);
        });

      const result = templateCollection.getTemplateNames().then(async ([templateName]) => {
        const template = await templateCollection.getTemplate(templateName, 'http://example.org/foo');

        templateMock = nock('http://example.com/')
          .get('/')
          .reply(200, () => template);

        await request(app)
          .post('/api/webmention')
          .send({
            source: 'http://example.com/',
            target: 'http://example.org/foo'
          })
          .expect(202);
      });
    });

    it('should handle multiple mentions', async () => {
      const templateMock = nock('http://example.com')
        .get('/')
        .times(2)
        .reply(200, () =>
          '<div class="h-entry">' +
            '<a href="http://example.org/foo">First</a>' +
            '<a href="http://example.org/bar">second</a>' +
          '</div>'
        );

      await Promise.all(
        [
          'http://example.org/foo',
          'http://example.org/bar'
        ].map(async target => {
          await request(app)
            .post('/api/webmention')
            .send({
              source: 'http://example.com/',
              target
            })
            .expect(202);
          await asyncNotification();
        })
      );

      const result = await knex('mentions').count('url').first();
      templateMock.done();
      result.count.should.be.a('string').and.equal('2');
    });

    it('should update all existing source mentions on valid ping', async () => {
      const templateMock = nock('http://example.com')
        .get('/')
        .once()
        .reply(200, () => '<div class="h-entry">' +
            '<a href="http://example.org/foo">First</a>' +
            '<a href="http://example.org/bar">second</a>' +
          '</div>'
        )
        .get('/')
        .once()
        .reply(200, () => '<div class="h-entry">' +
            '<a class="u-like-of" href="http://example.org/foo">First</a>' +
            '<a href="http://example.org/bar">second</a>' +
          '</div>'
        );

      await [
        'http://example.org/foo',
        'http://example.org/bar'
      ].reduce(async (promiseChain, target) => {
        await promiseChain;

        await request(app)
          .post('/api/webmention')
          .send({
            source: 'http://example.com/',
            target
          })
          .expect(202);

        await asyncNotification();
      }, Promise.resolve());

      templateMock.done();

      const result = await knex('mentions').select().orderBy('url', 'desc');

      result.should.be.an('array').with.a.lengthOf(2);
      result.should.have.nested.property('[0].url', 'http://example.org/foo');
      result.should.have.nested.property('[0].interaction', true);
      result.should.not.have.nested.property('[0].updated', null);
      result.should.have.nested.property('[0].removed', false);
      result.should.have.nested.property('[1].url', 'http://example.org/bar');
      result.should.have.nested.property('[1].interaction', false);
      result.should.have.nested.property('[1].updated', null);
      result.should.have.nested.property('[1].removed', false);

      const secondResult = await knex('entries').select();
      secondResult.should.be.an('array').with.a.lengthOf(1);
      secondResult.should.have.nested.property('[0].url', 'http://example.com/');
      secondResult.should.have.nested.property('[0].published').that.is.a('date');
      secondResult.should.have.nested.property('[0].updated').that.is.a('date').that.not.equals(secondResult[0].published);
      secondResult.should.have.nested.property('[0].type', 'like');
      secondResult.should.have.nested.property('[0].data.interactionType', 'like');
      secondResult.should.have.nested.property('[0].data.interactions').that.deep.equals(['http://example.org/foo']);
    });

    it('should update on repeated ping', async () => {
      const templateMocks = [
        nock('http://example.com')
          .get('/')
          .times(1)
          .reply(200, () => '<div class="h-entry">' +
              '<a href="http://example.org/foo">First</a>' +
            '</div>'
          ),

        nock('http://example.com')
          .get('/')
          .times(1)
          .reply(200, () => '<div class="h-entry">' +
              '<a class="u-like-of" href="http://example.org/foo">First</a>' +
            '</div>'
          )
      ];

      for (const [i, element] of templateMocks.entries()) {
        await request(app)
          .post('/api/webmention')
          .send({
            source: 'http://example.com/',
            target: 'http://example.org/foo'
          })
          .expect(202);

        await asyncNotification();

        element.done();

        const result = await knex('entries').select();

        result.should.be.an('array').with.a.lengthOf(1);
        result.should.have.nested.property('[0].published').that.is.a('date');
        result.should.have.nested.property('[0].updated').that.is.a('date');

        if (i === 0) {
          result.should.have.nested.property('[0].type', null);
          result.should.not.have.nested.property('[0].data.interactionType');
          result.should.not.have.nested.property('[0].data.interactions');

          result[0].published.valueOf()
            .should.equal(result[0].updated.valueOf());
        } else {
          result.should.have.nested.property('[0].updated').that.not.equals(result[0].published);
          result.should.have.nested.property('[0].type', 'like');
          result.should.have.nested.property('[0].data.interactionType', 'like');
          result.should.have.nested.property('[0].data.interactions').that.deep.equals(['http://example.org/foo']);
        }
      }
    });

    it('should update remove all outdated source mentions on valid ping', async () => {
      const templateMock1 = nock('http://example.com')
        .get('/')
        .times(1)
        .reply(200, () => '<div class="h-entry">' +
            '<a href="http://example.org/foo">First</a>' +
          '</div>'
        );

      const templateMock2 = nock('http://example.com')
        .get('/')
        .times(1)
        .reply(200, () => '<div class="h-entry">' +
            '<a href="http://example.org/bar">second</a>' +
          '</div>'
        );

      await [
        'http://example.org/foo',
        'http://example.org/bar'
      ].reduce(async (promiseChain, target) => {
        await promiseChain;

        await request(app)
          .post('/api/webmention')
          .send({
            source: 'http://example.com/',
            target
          })
          .expect(202);

        await asyncNotification();
      }, Promise.resolve());

      templateMock1.done();
      templateMock2.done();

      const result = await knex('mentions').select().orderBy('url', 'desc');

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

    it('should properly handle pings of site that returns 404:s');
  });

  describe('salmention', () => {
    it('should fetch comments found on mentions', async () => {
      const templateMock = nock('http://example.com')
        .get('/')
        .once()
        .reply(200, () => '<div class="h-entry">' +
            '<a href="http://example.org/foo">First</a>' +
            '<a class="u-comment" href="http://example.com/foo">First</a>' +
          '</div>'
        )
        .get('/foo')
        .once()
        .reply(200, () => '<div class="h-entry">' +
            '<a href="http://example.com/">First</a>' +
          '</div>'
        );

      await request(app)
        .post('/api/webmention')
        .send({
          source: 'http://example.com/',
          target: 'http://example.org/foo'
        })
        .expect(202);

      await asyncNotification(2);

      templateMock.done();

      const result = await Promise.all([
        knex('entries').count('id').first(),
        knex('mentions').count('eid').first()
      ]);

      result.should.deep.equal([
        { count: '2' },
        { count: '2' }
      ]);
    });

    it('should fetch responses-links found on mentions', async () => {
      const templateMock = nock('http://example.com')
        .get('/')
        .once()
        .reply(200, () => '<div class="h-entry">' +
            '<a href="http://example.org/foo">First</a>' +
            '<a class="u-responses" href="http://example.com/bar">First</a>' +
          '</div>'
        )
        .get('/bar')
        .once()
        .reply(200, () => '<div class="h-entry">' +
            '<a class="u-url" href="http://example.com/foo">First</a>' +
          '</div>'
        )
        .get('/foo')
        .once()
        .reply(200, () => '<div class="h-entry">' +
            '<a href="http://example.com/">First</a>' +
          '</div>'
        );

      await request(app)
        .post('/api/webmention')
        .send({
          source: 'http://example.com/',
          target: 'http://example.org/foo'
        })
        .expect(202);

      await asyncNotification(2);

      templateMock.done();

      const result = await Promise.all([
        knex('entries').count('id').first(),
        knex('mentions').count('eid').first()
      ]);

      result.should.deep.equal([
        { count: '2' },
        { count: '2' }
      ]);
    });

    it('should fetch and ping upstream salmention targets of mention', async () => {
      const templateMock = nock('http://example.com')
        .get('/')
        .once()
        .reply(200, () => '<div class="h-entry">' +
            '<a href="http://example.net/foo">First</a>' +
          '</div>'
        );

      const targetMock = nock('http://example.net')
        .get('/foo')
        .once()
        .reply(200, () => '<div class="h-entry">' +
            '<a class="u-in-reply-to" href="http://example.net/bar">First</a>' +
          '</div>'
        )
        .get('/bar')
        .once()
        .reply(200, () => '<html><head>' +
            '<link rel="webmention" href="http://webmention.example.com/ping" />' +
          '</head><body>' +
              '<div class="h-entry">a simple linkless entry</div>' +
          '</html>'
        );

      const pingMock = nock('http://webmention.example.com')
        .post('/ping', {
          source: 'http://example.net/foo',
          target: 'http://example.net/bar'
        })
        .once()
        .reply(202);

      await request(app)
        .post('/api/webmention')
        .send({
          source: 'http://example.com/',
          target: 'http://example.net/foo'
        })
        .expect(202);

      await asyncNotification(3);

      // TODO: Improve – relyng on timers in tests are pretty fragile
      await promisedWait(300);

      templateMock.done();
      targetMock.done();
      pingMock.done();

      const result = await Promise.all([
        knex('entries').count('id').first(),
        knex('mentions').count('eid').first()
      ]);

      result.should.deep.equal([
        { count: '3' },
        { count: '1' }
      ]);
    });

    it('should fetch and ping upstream salmention targets on downstream mention', async () => {
      const templateMock = nock('http://example.com')
        .get('/')
        .once()
        .reply(200, () => '<div class="h-entry">' +
            '<a href="http://example.net/foo">First</a>' +
            '<a class="u-comment" href="http://example.com/foo">First</a>' +
          '</div>'
        )
        .get('/foo')
        .once()
        .reply(200, () => '<div class="h-entry">' +
            '<a href="http://example.com/">First</a>' +
          '</div>'
        );

      const targetMock = nock('http://example.net')
        .get('/foo')
        .twice() // TODO: Should be .once() really
        .reply(200, () => '<div class="h-entry">' +
            '<a class="u-in-reply-to" href="http://example.net/bar">First</a>' +
          '</div>'
        )
        .get('/bar')
        .twice() // TODO: Should be .once() really
        .reply(200, () => '<html><head>' +
            '<link rel="webmention" href="http://webmention.example.com/ping" />' +
          '</head><body>' +
              '<div class="h-entry">a simple linkless entry</div>' +
          '</html>'
        );

      const pingMock = nock('http://webmention.example.com')
        .post('/ping', {
          source: 'http://example.net/foo',
          target: 'http://example.net/bar'
        })
        .twice() // TODO: Should be .once() really
        .reply(202);

      await request(app)
        .post('/api/webmention')
        .send({
          source: 'http://example.com/',
          target: 'http://example.net/foo'
        })
        .expect(202);

      await asyncNotification(4);

      // TODO: Improve – relying on timers in tests are pretty fragile
      await promisedWait(300);

      templateMock.done();
      targetMock.done();
      pingMock.done();

      const result = await Promise.all([
        knex('entries').count('id').first(),
        knex('mentions').count('eid').first()
      ]);

      result.should.deep.equal([
        { count: '4' },
        { count: '2' }
      ]);
    });

    it('should fetch and ping upstream salmention person tags', async () => {
      const templateMock = nock('http://example.com')
        .get('/')
        .once()
        .reply(200, () => '<div class="h-entry">' +
            '<a href="http://example.net/foo">First</a>' +
          '</div>'
        );

      const targetMock = nock('http://example.net')
        .get('/foo')
        .once()
        .reply(200, () => '<div class="h-entry">' +
            '<a href="http://example.net/bar" class="u-category h-card">Bob Smith</a>' +
          '</div>'
        )
        .get('/bar')
        .once()
        .reply(200, () => '<html><head>' +
            '<link rel="webmention" href="http://webmention.example.com/ping" />' +
          '</head><body>' +
              '<div class="h-entry">a simple linkless entry</div>' +
          '</html>'
        );

      const pingMock = nock('http://webmention.example.com')
        .post('/ping', {
          source: 'http://example.net/foo',
          target: 'http://example.net/bar'
        })
        .once()
        .reply(202);

      await request(app)
        .post('/api/webmention')
        .send({
          source: 'http://example.com/',
          target: 'http://example.net/foo'
        })
        .expect(202);

      await asyncNotification(3);

      // TODO: Improve – relying on timers in tests are pretty fragile
      await promisedWait(300);

      templateMock.done();
      targetMock.done();
      pingMock.done();

      const result = await Promise.all([
        knex('entries').count('id').first(),
        knex('mentions').count('eid').first()
      ]);

      result.should.deep.equal([
        { count: '3' },
        { count: '1' }
      ]);
    });
  });

  describe('error handling', () => {
    it('should reject malformed source URL:s', async () =>
      request(app)
        .post('/api/webmention')
        .send({
          source: 'invalid',
          target: 'http://example.org/foo'
        })
        .expect(400)
    );

    it('should reject malformed target URL:s', async () =>
      request(app)
        .post('/api/webmention')
        .send({
          source: 'http://example.org/foo',
          target: 'invalid'
        })
        .expect(400)
    );

    it('should reject when source and target URL:s are equal', async () =>
      request(app)
        .post('/api/webmention')
        .send({
          source: 'http://example.org/foo',
          target: 'http://example.org/foo'
        })
        .expect(400)
    );

    it('should reject when normalized source and target URL:s are equal', async () =>
      Promise.all([
        request(app)
          .post('/api/webmention')
          .send({
            source: 'https://example.org/foo',
            target: 'http://example.org/foo'
          })
          .expect(400),
        request(app)
          .post('/api/webmention')
          .send({
            source: 'https://www.example.org/foo',
            target: 'http://example.org/foo/#foobar'
          })
          .expect(400)
      ])
    );
  });

  // TODO: Add in its own file
  describe('live updates', () => {
    it.skip('should return data in an expected format');

    // Test the resolveDerivedData() method and use
    it.skip('should derive interaction target status correctly');
  });
});
