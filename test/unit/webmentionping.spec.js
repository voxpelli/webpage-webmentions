/* jshint nonew:false */
/* global beforeEach, describe, it */

"use strict";

var chai = require('chai'),
  chaiAsPromised = require('chai-as-promised'),
  Promise = require('promise'),
  expect;

chai.use(chaiAsPromised);
chai.should();
expect = chai.expect;

describe('WebMentionPing', function () {
  var WebMentionPing = require('../../lib/classes/webmentionping'),
    ping, exampleHtml, parsedExample;

  // Taken from the h-entry Microformats wiki page
  exampleHtml = '<article class="h-entry">' +
    '  <h1 class="p-name">Microformats are amazing</h1>' +
    '  <p>Published by <a class="p-author h-card" href="http://example.com">W. Developer</a>' +
    '     on <time class="dt-published" datetime="2013-06-13 12:00:00">13<sup>th</sup> June 2013</time>' +
    '  <p class="p-summary">In which I extoll the virtues of using microformats.</p>' +
    '  <div class="e-content">' +
    '    <p><a href="http://example.org/bar">Blah</a> blah blah</p>' +
    '  </div>' +
    '</article>';

  parsedExample = {
    "items": [{
      "properties": {
        "author": [{
          "properties": {
            "name": ["W. Developer"],
            "url": ["http://example.com"]
          },
          "type": [
            "h-card"
          ],
          "value": "W. Developer"
        }],
        "content": [{
          "html": "    <p><a href=\"http://example.org/bar\">Blah</a> blah blah</p>  ",
          "value": "Blah blah blah"
        }],
        "name": ["Microformats are amazing"],
        "published": ["2013-12-18T22:45:00Z"],
        "summary": ["In which I extoll the virtues of using microformats."]
      },
      "type": ["h-entry"]
    }],
    "rels": {}
  };

  beforeEach(function () {
    ping = new WebMentionPing('http://example.com/foo', 'http://example.org/bar');
  });

  describe('parseSourcePage', function () {

    it('should fulfill if target is linked', function () {
      return ping.parseSourcePage('<a href="http://example.org/bar">Bar</a>').should.be.fulfilled;
    });

    it('should reject if no link to target linked', function () {
      return ping.parseSourcePage('<a href="http://example.com/elsewhere">123</a>').should.be.rejectedWith("Couldn't find a link");
    });

    it('should parse the microformats data', function () {
      return ping.parseSourcePage(exampleHtml)
        .should.eventually.be.an('object')
        .should.eventually.contain.keys('items', 'rels')
        .should.eventually.have.deep.property('items[0].properties')
          .that.is.an('object')
          .that.contain.keys('author', 'name', 'published', 'summary')
          .that.have.deep.property('author[0].properties.name[0]', 'W. Developer');
    });

    it('should ensure that there is always a path component', function () {
      var altPing1, altPing2;

      altPing1 = new WebMentionPing('http://example.com/foo', 'http://example.org');
      altPing2 = new WebMentionPing('http://example.com/foo', 'http://example.org/');

      return Promise.all([
        altPing1.parseSourcePage('<a href="http://example.org/">Bar</a>').should.be.fulfilled,
        altPing1.parseSourcePage('<a href="http://example.org">Bar</a>').should.be.fulfilled,
        altPing1.parseSourcePage('<a href="http://example.org/bar">Bar</a>').should.be.rejectedWith("Couldn't find a link"),
        altPing1.parseSourcePage('<a href="http://example.org/bar/">Bar</a>').should.be.rejectedWith("Couldn't find a link"),
        altPing2.parseSourcePage('<a href="http://example.org/">Bar</a>').should.be.fulfilled,
        altPing2.parseSourcePage('<a href="http://example.org">Bar</a>').should.be.fulfilled,
        altPing2.parseSourcePage('<a href="http://example.org/bar">Bar</a>').should.be.rejectedWith("Couldn't find a link"),
      ]);
    });

    it('should ignore trailing slashes when looking for target', function () {
      var altPing1, altPing2, altPing3, altPing4;

      altPing1 = new WebMentionPing('http://example.com/foo', 'http://example.org/bar/');
      altPing2 = new WebMentionPing('http://example.com/foo', 'http://example.org/bar');
      altPing3 = new WebMentionPing('http://example.com/foo', 'http://example.org/bar/?bar=1');
      altPing4 = new WebMentionPing('http://example.com/foo', 'http://example.org/bar?bar=1');

      return Promise.all([
        altPing1.parseSourcePage('<a href="http://example.org/bar">Bar</a>').should.be.fulfilled,
        altPing1.parseSourcePage('<a href="http://example.org/bar/">Bar</a>').should.be.fulfilled,
        altPing1.parseSourcePage('<a href="http://example.org/">Bar</a>').should.be.rejectedWith("Couldn't find a link"),

        altPing2.parseSourcePage('<a href="http://example.org/bar">Bar</a>').should.be.fulfilled,
        altPing2.parseSourcePage('<a href="http://example.org/bar/">Bar</a>').should.be.fulfilled,
        altPing2.parseSourcePage('<a href="http://example.org/">Bar</a>').should.be.rejectedWith("Couldn't find a link"),

        altPing3.parseSourcePage('<a href="http://example.org/bar?bar=1">Bar</a>').should.be.fulfilled,
        altPing3.parseSourcePage('<a href="http://example.org/bar/?bar=1">Bar</a>').should.be.fulfilled,
        altPing3.parseSourcePage('<a href="http://example.org/bar/">Bar</a>').should.be.rejectedWith("Couldn't find a link"),

        altPing4.parseSourcePage('<a href="http://example.org/bar?bar=1">Bar</a>').should.be.fulfilled,
        altPing4.parseSourcePage('<a href="http://example.org/bar/?bar=1">Bar</a>').should.be.fulfilled,
        altPing4.parseSourcePage('<a href="http://example.org/bar/">Bar</a>').should.be.rejectedWith("Couldn't find a link"),
      ]);
    });

    it('should ignore double slashes when looking for target', function () {
      var altPing1, altPing2, altPing3;

      altPing1 = new WebMentionPing('http://example.com/foo', 'http://example.org/bar/');
      altPing2 = new WebMentionPing('http://example.com/foo', 'http://example.org/bar//foo');
      altPing3 = new WebMentionPing('http://example.com/foo', 'http://example.org/bar/?bar=1//2');

      return Promise.all([
        altPing1.parseSourcePage('<a href="http://example.org/bar//">Bar</a>').should.be.fulfilled,

        altPing2.parseSourcePage('<a href="http://example.org/bar/foo">Bar</a>').should.be.fulfilled,
        altPing2.parseSourcePage('<a href="http://example.org/bar//foo">Bar</a>').should.be.fulfilled,
        altPing2.parseSourcePage('<a href="http://example.org/bar///foo///">Bar</a>').should.be.fulfilled,

        altPing3.parseSourcePage('<a href="http://example.org/bar/?bar=1//2">Bar</a>').should.be.fulfilled,
        altPing3.parseSourcePage('<a href="http://example.org/bar/?bar=1/2">Bar</a>').should.be.rejectedWith("Couldn't find a link"),
      ]);
    });

    it('should ignore whether it is http, https or no protocol when looking for target', function () {
      var altPing1, altPing2, altPing3;

      altPing1 = new WebMentionPing('http://example.com/foo', 'https://example.org/bar');
      altPing2 = new WebMentionPing('http://example.com/foo', 'http://example.org/bar');
      altPing3 = new WebMentionPing('http://example.com/foo', '//example.org/bar');

      expect(function () {
        new WebMentionPing('http://example.com/foo', '/bar');
      }).to.throw();

      return Promise.all([
        altPing1.parseSourcePage('<a href="https://example.org/bar">Bar</a>').should.be.fulfilled,
        altPing1.parseSourcePage('<a href="http://example.org/bar">Bar</a>').should.be.fulfilled,
        altPing1.parseSourcePage('<a href="//example.org/bar">Bar</a>').should.be.fulfilled,

        altPing2.parseSourcePage('<a href="https://example.org/bar">Bar</a>').should.be.fulfilled,
        altPing2.parseSourcePage('<a href="http://example.org/bar">Bar</a>').should.be.fulfilled,
        altPing2.parseSourcePage('<a href="//example.org/bar">Bar</a>').should.be.fulfilled,

        altPing3.parseSourcePage('<a href="https://example.org/bar">Bar</a>').should.be.fulfilled,
        altPing3.parseSourcePage('<a href="http://example.org/bar">Bar</a>').should.be.fulfilled,
        altPing3.parseSourcePage('<a href="//example.org/bar">Bar</a>').should.be.fulfilled,
      ]);
    });

    it('should ignore www subdomains', function () {
      var altPing1, altPing2, altPing3, altPing4;

      altPing1 = new WebMentionPing('http://example.com/foo', 'http://www.example.org/bar');
      altPing2 = new WebMentionPing('http://example.com/foo', 'http://example.org/bar');
      altPing3 = new WebMentionPing('http://example.com/foo', 'http://foo.example.org/bar');
      altPing4 = new WebMentionPing('http://example.com/foo', 'http://www.foo.example.org/bar');

      expect(function () {
        new WebMentionPing('http://example.com/foo', '/bar');
      }).to.throw();

      return Promise.all([
        altPing1.parseSourcePage('<a href="http://www.example.org/bar">Bar</a>').should.be.fulfilled,
        altPing1.parseSourcePage('<a href="http://example.org/bar">Bar</a>').should.be.fulfilled,
        altPing1.parseSourcePage('<a href="http://foo.example.org/bar">Bar</a>').should.be.rejectedWith("Couldn't find a link"),
        altPing1.parseSourcePage('<a href="http://www.www.example.org/bar">Bar</a>').should.be.rejectedWith("Couldn't find a link"),

        altPing2.parseSourcePage('<a href="http://www.example.org/bar">Bar</a>').should.be.fulfilled,
        altPing2.parseSourcePage('<a href="http://example.org/bar">Bar</a>').should.be.fulfilled,
        altPing2.parseSourcePage('<a href="http://foo.example.org/bar">Bar</a>').should.be.rejectedWith("Couldn't find a link"),

        altPing3.parseSourcePage('<a href="http://foo.example.org/bar">Bar</a>').should.be.fulfilled,
        altPing3.parseSourcePage('<a href="http://example.org/bar">Bar</a>').should.be.rejectedWith("Couldn't find a link"),
        altPing3.parseSourcePage('<a href="http://www.foo.example.org/bar">Bar</a>').should.be.rejectedWith("Couldn't find a link"),

        altPing4.parseSourcePage('<a href="http://www.foo.example.org/bar">Bar</a>').should.be.fulfilled,
        altPing4.parseSourcePage('<a href="http://foo.example.org/bar">Bar</a>').should.be.rejectedWith("Couldn't find a link"),
      ]);
    });

    it('should ignore fragments', function () {
      var altPing1, altPing2;

      altPing1 = new WebMentionPing('http://example.com/foo', 'http://example.org/bar#foo');
      altPing2 = new WebMentionPing('http://example.com/foo', 'http://example.org/bar');

      expect(function () {
        new WebMentionPing('http://example.com/foo', '/bar');
      }).to.throw();

      return Promise.all([
        altPing1.parseSourcePage('<a href="http://example.org/bar">Bar</a>').should.be.fulfilled,
        altPing1.parseSourcePage('<a href="http://example.org/bar#foo">Bar</a>').should.be.fulfilled,

        altPing2.parseSourcePage('<a href="http://example.org/bar">Bar</a>').should.be.fulfilled,
        altPing2.parseSourcePage('<a href="http://example.org/bar#foo">Bar</a>').should.be.fulfilled,
      ]);
    });

  });

  describe('createMention', function () {

    it('should give reasonable defaults when given empty data', function () {
      var input, mention;

      input = {
        items: [],
        rels: {}
      };

      mention = ping.createMention(input);

      mention.should.have.deep.property('data.published')
        .that.is.a('number')
        .that.is.closeTo(Date.now(), 2000);

      mention.should.have.property('raw', input);
      mention.should.have.property('url', 'http://example.com/foo');
    });

    it('should use input data', function () {
      var mention = ping.createMention(parsedExample);

      mention.should.have.property('url', 'http://example.com/foo');
      mention.should.have.property('raw', parsedExample);

      mention.should.have.deep.property('data.name', 'Microformats are amazing');
      mention.should.have.deep.property('data.summary', 'In which I extoll the virtues of using microformats.');
      mention.should.have.deep.property('data.published', 1387406700000);
      mention.should.have.deep.property('data.author.name', 'W. Developer');
      mention.should.have.deep.property('data.author.url', 'http://example.com/');
    });

  });
});
