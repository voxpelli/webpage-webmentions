var express = require('express'),
  http = require('http'),
  pg = require('pg'),
  ff = require('ff'),
  request = require('request'),
  cheerio = require('cheerio'),
  microformats = require('microformat-node'),
  server,
  app,
  options;

options = {
  db : process.env.DATABASE_URL
};

request = request.defaults({
  jar: false,
  timeout: 5000,
  maxRedirects : 9,
  headers: {
    'User-Agent' : 'WebMention-Hosted (https://github.com/voxpelli)'
  }
});

app = express()
  .use(express.favicon())
  .use(express.static(__dirname + '/../public'))
  .use(express.bodyParser());

app.get('/api/embed', function (req, res) {
  var target = req.query.url, f;
  f = ff(this,
    function () {
      pg.connect(options.db, f.slotMulti(2));
    },
    function (client, done) {
      f.onComplete(done);
      client.query('SELECT data FROM entries AS e INNER JOIN mentions AS m ON e.id = m.eid WHERE m.url = $1', [target], f.slot());
    },
    function (result) {
      res.json(result.rows);
    }
  ).onError(function (err) {
    console.warn(err);
    res.json(400, {
      error : true,
      message : 'An unexpected error occured'
    });
  });
});

app.post('/api/webmention', function (req, res) {
  var source, target, f;

  if (!req.body.source || !req.body.target) {
    res.json(400, {
      error : true,
      message : 'You need to specify both a "source" and a "target" URL'
    });
    return;
  }

  //TODO: Check the host of req.body.target - that we allow that

  source = req.body.source;
  target = req.body.target;

  //TODO: Break the below up into methods to allow for more granular error handling

  f = ff(this,
    function () {
      request({ uri: source }, f.slotMulti(2))
    },
    function (response, body) {
      if (response.statusCode !== 200) {
        f.fail(new Error('Expected HTTP code 200'))
        return;
      }

      var $ = cheerio.load(body);

      if (!$('a[href="' + target.replace('"', '%22') + '"]').length) {
        f.fail(new Error("Couldn't find a link from source to target"));
      } else {
        console.info('Microformatparsing');
        microformats.parseDom($, $.root(), {
          filters : ['h-entry']
        }, f.slot());
      }
    },
    function (data) {
      entry = {
        url : source
      };

      if (data.items.length) {
        entry.name = data.items[0].properties.name[0];
        entry.url = data.items[0].properties.url[0];
        entry.published = data.items[0].properties.published[0];
        entry.author = {
          name : data.items[0].properties.author[0].properties.name[0],
          photo : data.items[0].properties.author[0].properties.photo[0],
          url : data.items[0].properties.author[0].properties.url[0]
        };
      }

      f.pass(entry, data);

      pg.connect(options.db, f.slotMulti(2));
    },
    function (entry, entryRaw, client, done) {
      var url = entry.url;

      f.onComplete(done);
      f.pass(client);

      client.query('INSERT INTO entries (url, data, raw) VALUES ($1, $2, $3) RETURNING id', [url, entry, entryRaw], f.slot());
    },
    function (client, result) {
      client.query('INSERT INTO mentions (url, eid) VALUES ($1, $2)', [target, result.rows[0].id], f.slot());
      res.json({
        success : true
      });
    }
  ).onError(function (err) {
    console.log(err);
    console.log(err.stack);
    res.json(400, {
      error : true
    });
  });
});

server = http.createServer(app);
server.listen(process.env.PORT || 8080);

