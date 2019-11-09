// @ts-check
/// <reference types="node" />
/// <reference types="mocha" />
/// <reference types="chai" />
/// <reference types="sinon" />
/// <reference types="supertest" />

'use strict';

const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');
const request = require('supertest');
const nock = require('nock');
const sinon = require('sinon');

const dbUtils = require('../db-utils');

chai.use(chaiAsPromised);
chai.should();

/**
 * @param {number} timeout
 * @returns {Promise<void>}
 */
const promisedWait = (timeout) => new Promise(resolve => setTimeout(resolve, timeout));

describe('Fetch mentions', function () {
  this.timeout(15000);

  let app;

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

  describe('main', () => {
    beforeEach(() => dbUtils.setupSampleMentions());

    const matchMentions = (done, count, err, res) => {
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

    it('should return all matching mentions in an expected format', (done) => {
      request(app)
        .get('/api/mentions')
        .query({ url: 'http://example.org/foo' })
        .expect(200)
        .end((err, res) => matchMentions(done, 4, err, res));
    });

    it('should return example mentions in an expected format', (done) => {
      request(app)
        .get('/api/mentions')
        .query({ example: 1 })
        .expect(200)
        .end((err, res) => matchMentions(done, 14, err, res));
    });

    // Test the resolveDerivedData() method and use
    it.skip('should derive interaction target status correctly');

    it('should allow matching based on hostname', (done) => {
      request(app)
        .get('/api/mentions')
        .query({ site: 'example.org' })
        .expect(200)
        .end((err, res) => {
          if (err) {
            return done(err);
          }

          res.body.should.be.an('array').of.length(10);
          res.body.should.have.nested.property('[0].author.name');

          done();
        });
    });

    it('should ignore www. in hostname', (done) => {
      request(app)
        .get('/api/mentions')
        .query({ site: 'www.example.org' })
        .expect(200)
        .end((err, res) => {
          if (err) {
            return done(err);
          }

          res.body.should.be.an('array').of.length(10);
          res.body.should.have.nested.property('[0].author.name');

          done();
        });
    });

    it('should allow matching based on path', () => {
      return [
        () => new Promise((resolve, reject) => {
          request(app)
            .get('/api/mentions')
            .query({ path: 'http://example.org/path' })
            .expect(200)
            .end((err, res) => {
              if (err) {
                return reject(err);
              }

              res.body.should.be.an('array').of.length(9);
              res.body.should.have.nested.property('[0].author.name');

              resolve();
            });
        }),
        () => new Promise((resolve, reject) => {
          request(app)
            .get('/api/mentions')
            .query({ path: 'http://example.org/foo' })
            .expect(200)
            .end((err, res) => {
              if (err) {
                return reject(err);
              }

              res.body.should.be.an('array').of.length(4);
              res.body.should.have.nested.property('[0].author.name');

              resolve();
            });
        }),
        () => new Promise((resolve, reject) => {
          // Test that the escaping works
          request(app)
            .get('/api/mentions')
            .query({ path: ['http://example.org/%h', 'http://example.org/p_th'] })
            .expect(200)
            .end((err, res) => {
              if (err) {
                return reject(err);
              }

              res.body.should.be.an('array').of.length(0);

              resolve();
            });
        })
      ].reduce((result, next) => result.then(next), Promise.resolve());
    });

    it('should ignore handle multiple matches', (done) => {
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
        .end((err, res) => {
          if (err) {
            return done(err);
          }

          res.body.should.be.an('array').of.length(6);
          res.body.should.have.nested.property('[0].author.name');

          done();
        });
    });

    it('should sort the result', () => {
      return new Promise((resolve, reject) => {
        request(app)
          .get('/api/mentions')
          .query({ path: 'http://example.org/path' })
          .expect(200)
          .end((err, res) => {
            if (err) {
              return reject(err);
            }

            res.body.should.be.an('array').and.satisfy(
              entries =>
                entries.reduce((previousValue, currentValue) => {
                  previousValue = previousValue.published || previousValue;
                  if (previousValue === false || previousValue >= currentValue.published) {
                    return false;
                  }
                  return currentValue.published;
                }) !== false,
              'Should sort by publish date, starting with the oldest one'
            );

            resolve();
          });
      });
    });

    it('should sort the result reversed when requested to', () => {
      return new Promise((resolve, reject) => {
        request(app)
          .get('/api/mentions')
          .query({ path: 'http://example.org/path', sort: 'desc' })
          .expect(200)
          .end((err, res) => {
            if (err) {
              return reject(err);
            }

            res.body.should.be.an('array').and.satisfy(
              entries =>
                entries.reduce((previousValue, currentValue) => {
                  previousValue = previousValue.published || previousValue;
                  if (previousValue !== undefined && (previousValue === false || previousValue <= currentValue.published)) {
                    return false;
                  }
                  return currentValue.published;
                }) !== false,
              'Should sort by publish date, starting with the newest one'
            );

            resolve();
          });
      });
    });

    it('should return in HTML when requested', (done) => {
      request(app)
        .get('/api/mentions')
        .query({ site: 'example.org', format: 'html' })
        .expect(200)
        .end((err, res) => {
          if (err) {
            return done(err);
          }

          done();
        });
    });
  });
});
