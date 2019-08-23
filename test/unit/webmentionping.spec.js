'use strict';

const chai = require('chai');
const chaiAsPromised = require('chai-as-promised');
const cloneDeep = require('lodash.clonedeep');

chai.use(chaiAsPromised);
chai.should();

describe('MetaDataParser', () => {
  const Entry = require('../../lib/classes/entry');
  const MetaDataParser = require('@voxpelli/metadataparser').MetaDataParser;
  const MetaDataParserMf2 = require('@voxpelli/metadataparser-mf2');

  let parser, sourceUrl, targetUrl;

  // Taken from the h-entry Microformats wiki page
  const exampleHtml = '<article class="h-entry">' +
    '  <h1 class="p-name"><a class="u-url" href="http://example.net/abc">Microformats are amazing</a></h1>' +
    '  <p>Published by <a class="p-author h-card" href="http://example.com">W. Developer</a>' +
    '     on <time class="dt-published" datetime="2013-06-13 12:00:00">13<sup>th</sup> June 2013</time>' +
    '  <p class="p-summary">In which I extoll the virtues of using microformats.</p>' +
    '  <div class="e-content">' +
    '    <p><a href="http://example.org/bar">Blah</a> blah blah</p>' +
    '  </div>' +
    '</article>';

  const parsedExample = {
    items: [{
      properties: {
        author: [{
          properties: {
            name: ['W. Developer'],
            url: ['http://example.com']
          },
          type: [
            'h-card'
          ],
          value: 'W. Developer'
        }],
        content: [{
          html: '    <p><a href="http://example.org/bar">Blah</a> blah blah</p>  ',
          value: 'Blah blah blah'
        }],
        name: ['Microformats are amazing'],
        published: ['2013-06-13T12:00:00'],
        summary: ['In which I extoll the virtues of using microformats.'],
        url: ['http://example.net/abc']
      },
      type: ['h-entry']
    }],
    'rel-urls': {},
    rels: {}
  };

  const xssExample = {
    items: [{
      properties: {
        author: [{
          properties: {
            name: ['W. Developer'],
            url: ["javascript:alert('hcard')"]
          },
          type: [
            'h-card'
          ],
          value: 'W. Developer'
        }],
        content: [{
          html: '<p><a href="http://example.org/bar">Blah</a> blah blah</p>  ',
          value: 'Blah blah blah'
        }],
        name: ['Microformats are amazing'],
        published: ['2013-12-18T22:45:00Z'],
        summary: ['In which I extoll the virtues of using microformats.'],
        url: ["javascript:alert('hentry')"]
      },
      type: ['h-entry']
    }],
    rels: {}
  };

  const getEntry = (html) => parser.extract(sourceUrl, html)
    .then(metadata => new Entry(sourceUrl, metadata));

  const matchTarget = (html, target) => getEntry(html)
    .then(entry => entry.hasTarget(target));

  beforeEach(() => {
    parser = MetaDataParserMf2.addToParser(new MetaDataParser());

    sourceUrl = 'http://example.com/foo';
    targetUrl = 'http://example.org/bar';
  });

  describe('extract', () => {
    it('should fulfill if target is linked', () => {
      return matchTarget('<a href="http://example.org/bar">Bar</a>', targetUrl).should.eventually.be.ok;
    });

    it('should reject if no link to target linked', () => {
      return matchTarget('<a href="http://example.com/elsewhere">123</a>', targetUrl).should.eventually.not.be.ok;
    });

    it('should not choke on non-http URL:s', () => {
      return matchTarget('<a href="mailto:foo@example.com">Mail</a> <a href="http://example.org/bar">Bar</a>', targetUrl).should.eventually.be.ok;
    });

    it('should parse the microformats data', () => {
      return parser.extract(sourceUrl, exampleHtml)
        .should.eventually.be.an('object')
        .that.has.property('microformats')
        .that.contain.keys('items', 'rels')
        .and.has.nested.property('items[0].properties')
        .that.is.an('object')
        .that.contain.keys('author', 'name', 'published', 'summary')
        .that.have.nested.property('author[0].properties.name[0]', 'W. Developer');
    });

    it('should ensure that there is always a path component', () => {
      const altPing1 = 'http://example.org';
      const altPing2 = 'http://example.org/';

      return Promise.all([
        matchTarget('<a href="http://example.org/">Bar</a>', altPing1).should.eventually.be.ok,
        matchTarget('<a href="http://example.org">Bar</a>', altPing1).should.eventually.be.ok,
        matchTarget('<a href="http://example.org/bar">Bar</a>', altPing1).should.eventually.not.be.ok,
        matchTarget('<a href="http://example.org/bar/">Bar</a>', altPing1).should.eventually.not.be.ok,

        matchTarget('<a href="http://example.org/">Bar</a>', altPing2).should.eventually.be.ok,
        matchTarget('<a href="http://example.org">Bar</a>', altPing2).should.eventually.be.ok,
        matchTarget('<a href="http://example.org/bar">Bar</a>', altPing2).should.eventually.not.be.ok
      ]);
    });

    it('should ignore trailing slashes when looking for target', () => {
      const altPing1 = 'http://example.org/bar/';
      const altPing2 = 'http://example.org/bar';
      const altPing3 = 'http://example.org/bar/?bar=1';
      const altPing4 = 'http://example.org/bar?bar=1';

      return Promise.all([
        matchTarget('<a href="http://example.org/bar">Bar</a>', altPing1).should.eventually.be.ok,
        matchTarget('<a href="http://example.org/bar/">Bar</a>', altPing1).should.eventually.be.ok,
        matchTarget('<a href="http://example.org/">Bar</a>', altPing1).should.eventually.not.be.ok,

        matchTarget('<a href="http://example.org/bar">Bar</a>', altPing2).should.eventually.be.ok,
        matchTarget('<a href="http://example.org/bar/">Bar</a>', altPing2).should.eventually.be.ok,
        matchTarget('<a href="http://example.org/">Bar</a>', altPing2).should.eventually.not.be.ok,

        matchTarget('<a href="http://example.org/bar?bar=1">Bar</a>', altPing3).should.eventually.be.ok,
        matchTarget('<a href="http://example.org/bar/?bar=1">Bar</a>', altPing3).should.eventually.be.ok,
        matchTarget('<a href="http://example.org/bar/">Bar</a>', altPing3).should.eventually.not.be.ok,

        matchTarget('<a href="http://example.org/bar?bar=1">Bar</a>', altPing4).should.eventually.be.ok,
        matchTarget('<a href="http://example.org/bar/?bar=1">Bar</a>', altPing4).should.eventually.be.ok,
        matchTarget('<a href="http://example.org/bar/">Bar</a>', altPing4).should.eventually.not.be.ok
      ]);
    });

    it('should ignore double slashes when looking for target', () => {
      const altPing1 = 'http://example.org/bar/';
      const altPing2 = 'http://example.org/bar//foo';
      const altPing3 = 'http://example.org/bar/?bar=1//2';

      return Promise.all([
        matchTarget('<a href="http://example.org/bar//">Bar</a>', altPing1).should.eventually.be.ok,

        matchTarget('<a href="http://example.org/bar/foo">Bar</a>', altPing2).should.eventually.be.ok,
        matchTarget('<a href="http://example.org/bar//foo">Bar</a>', altPing2).should.eventually.be.ok,
        matchTarget('<a href="http://example.org/bar///foo///">Bar</a>', altPing2).should.eventually.be.ok,

        matchTarget('<a href="http://example.org/bar/?bar=1//2">Bar</a>', altPing3).should.eventually.be.ok,
        matchTarget('<a href="http://example.org/bar/?bar=1/2">Bar</a>', altPing3).should.eventually.not.be.ok
      ]);
    });

    it('should ignore whether it is http, https or no protocol when looking for target', () => {
      const altPing1 = 'https://example.org/bar';
      const altPing2 = 'http://example.org/bar';
      const altPing3 = '//example.org/bar';

      return Promise.all([
        matchTarget('<a href="http://example.org/bar">Bar</a>', '/bar').should.be.rejected,

        matchTarget('<a href="https://example.org/bar">Bar</a>', altPing1).should.eventually.be.ok,
        matchTarget('<a href="http://example.org/bar">Bar</a>', altPing1).should.eventually.be.ok,
        matchTarget('<a href="//example.org/bar">Bar</a>', altPing1).should.eventually.be.ok,

        matchTarget('<a href="https://example.org/bar">Bar</a>', altPing2).should.eventually.be.ok,
        matchTarget('<a href="http://example.org/bar">Bar</a>', altPing2).should.eventually.be.ok,
        matchTarget('<a href="//example.org/bar">Bar</a>', altPing2).should.eventually.be.ok,

        matchTarget('<a href="https://example.org/bar">Bar</a>', altPing3).should.eventually.be.ok,
        matchTarget('<a href="http://example.org/bar">Bar</a>', altPing3).should.eventually.be.ok,
        matchTarget('<a href="//example.org/bar">Bar</a>', altPing3).should.eventually.be.ok
      ]);
    });

    it('should ignore www subdomains', () => {
      const altPing1 = 'http://www.example.org/bar';
      const altPing2 = 'http://example.org/bar';
      const altPing3 = 'http://foo.example.org/bar';
      const altPing4 = 'http://www.foo.example.org/bar';

      return Promise.all([
        matchTarget('<a href="http://www.example.org/bar">Bar</a>', altPing1).should.eventually.be.ok,
        matchTarget('<a href="http://example.org/bar">Bar</a>', altPing1).should.eventually.be.ok,
        matchTarget('<a href="http://foo.example.org/bar">Bar</a>', altPing1).should.eventually.not.be.ok,
        matchTarget('<a href="http://www.www.example.org/bar">Bar</a>', altPing1).should.eventually.not.be.ok,

        matchTarget('<a href="http://www.example.org/bar">Bar</a>', altPing2).should.eventually.be.ok,
        matchTarget('<a href="http://example.org/bar">Bar</a>', altPing2).should.eventually.be.ok,
        matchTarget('<a href="http://foo.example.org/bar">Bar</a>', altPing2).should.eventually.not.be.ok,

        matchTarget('<a href="http://foo.example.org/bar">Bar</a>', altPing3).should.eventually.be.ok,
        matchTarget('<a href="http://example.org/bar">Bar</a>', altPing3).should.eventually.not.be.ok,
        matchTarget('<a href="http://www.foo.example.org/bar">Bar</a>', altPing3).should.eventually.not.be.ok,

        matchTarget('<a href="http://www.foo.example.org/bar">Bar</a>', altPing4).should.eventually.be.ok,
        matchTarget('<a href="http://foo.example.org/bar">Bar</a>', altPing4).should.eventually.not.be.ok
      ]);
    });

    it('should ignore fragments', () => {
      const altPing1 = 'http://example.org/bar#foo';
      const altPing2 = 'http://example.org/bar';

      return Promise.all([
        matchTarget('<a href="http://example.org/bar">Bar</a>', altPing1).should.eventually.be.ok,
        matchTarget('<a href="http://example.org/bar#foo">Bar</a>', altPing1).should.eventually.be.ok,

        matchTarget('<a href="http://example.org/bar">Bar</a>', altPing2).should.eventually.be.ok,
        matchTarget('<a href="http://example.org/bar#foo">Bar</a>', altPing2).should.eventually.be.ok
      ]);
    });
  });

  describe('createMention', () => {
    it('should give reasonable defaults when given empty data', () => {
      const input = {
        items: [],
        rels: {}
      };

      const metadata = { microformats: input };

      const mention = new Entry(sourceUrl, metadata).getData();

      mention.should.have.nested.property('data.published')
        .that.is.a('number')
        .that.is.closeTo(Date.now(), 2000);

      mention.should.have.property('raw', metadata);
      mention.should.have.property('url', sourceUrl);
    });

    it('should use input data', () => {
      const metadata = { microformats: parsedExample };
      const mention = new Entry(sourceUrl, metadata).getData();

      mention.should.have.property('url', 'http://example.com/foo');
      mention.should.have.property('normalizedUrl', 'http://example.com/foo/');
      mention.should.have.property('raw', metadata);

      mention.should.have.nested.property('data.url', 'http://example.net/abc');
      mention.should.have.nested.property('data.name', 'Microformats are amazing');
      mention.should.have.nested.property('data.summary', 'In which I extoll the virtues of using microformats.');
      mention.should.have.nested.property('data.published', 1371124800000);
      mention.should.have.nested.property('data.author.name', 'W. Developer');
      mention.should.have.nested.property('data.author.url', 'http://example.com/');
    });

    it('should filter non-http(s) urls', () => {
      const mention = new Entry(sourceUrl, { microformats: xssExample }).getData();

      mention.should.have.property('url', 'http://example.com/foo');
      mention.should.have.nested.property('data.url', 'http://example.com/foo');
      mention.should.have.nested.property('data.author.url', null);
    });

    it('should parse dates correctly', () => {
      const values = {
        '2013-12-18T22:45:00Z': 1387406700000,
        '2013-09-08T07:21:50-07:00': 1378650110000
      };
      Object.keys(values).forEach(publishDate => {
        const timestamp = values[publishDate];
        const alternateExample = cloneDeep(parsedExample);
        alternateExample.items[0].properties.published[0] = publishDate;

        new Entry(sourceUrl, { microformats: alternateExample }).getData().should.have.nested.property('data.published', timestamp);
      });
    });
  });

  describe('parseSourcePage and createMention', () => {
    it('should create a correct mention from a basic page', () => {
      return getEntry(exampleHtml)
        .then(entry => entry.getData())
        .then(mention => {
          mention.should.have.property('url', 'http://example.com/foo');
          mention.should.have.property('normalizedUrl', 'http://example.com/foo/');
          mention.should.have.nested.property('raw.microformats').that.deep.equals(parsedExample);

          mention.should.have.nested.property('data.url', 'http://example.net/abc');
          mention.should.have.nested.property('data.name', 'Microformats are amazing');
          mention.should.have.nested.property('data.summary', 'In which I extoll the virtues of using microformats.');
          mention.should.have.nested.property('data.published', 1371124800000);
          mention.should.have.nested.property('data.author.name', 'W. Developer');
          mention.should.have.nested.property('data.author.url', 'http://example.com/');
        });
    });

    it('should resolve relative URL:s', () => {
      const relativeHtml = exampleHtml
        .replace('"http://example.net/abc"', '"/abc/123"')
        .replace(
          '<a class="p-author h-card" href="http://example.com">W. Developer</a>',
          '<a class="p-author h-card" href="bar.html"><img src="abc.png" alt="" /> W. Developer</a>'
        );

      return getEntry(relativeHtml)
        .then(entry => entry.getData())
        .then(mention => {
          mention.should.have.nested.property('data.url', 'http://example.com/abc/123');
          mention.should.have.nested.property('data.author.url', 'http://example.com/bar.html');
          mention.should.have.nested.property('data.author.photo', 'http://example.com/abc.png');
        });
    });
  });
});
