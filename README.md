# A WebMention Endpoint
[![Build Status](https://travis-ci.org/voxpelli/webpage-webmentions.svg?branch=master)](https://travis-ci.org/voxpelli/webpage-webmentions)
[![Coverage Status](https://coveralls.io/repos/github/voxpelli/webpage-webmentions/badge.svg?branch=master)](https://coveralls.io/github/voxpelli/webpage-webmentions?branch=master)
[![dependencies Status](https://david-dm.org/voxpelli/webpage-webmentions/status.svg)](https://david-dm.org/voxpelli/webpage-webmentions)
[![FOSSA Status](https://app.fossa.io/api/projects/git%2Bgithub.com%2Fvoxpelli%2Fwebpage-webmentions.svg?type=shield)](https://app.fossa.io/projects/git%2Bgithub.com%2Fvoxpelli%2Fwebpage-webmentions?ref=badge_shield)

A site that receives and embeds [WebMentions](http://indiewebcamp.com/webmention) for other sites. makes the WebMentions embeddable through a javascript, similar to how eg. Disqus works.

A live deploy of this can be found on [webmention.herokuapp.com](https://webmention.herokuapp.com/). One can also sign up to that one rather than deploying ones own if one likes.

## Deploying it yourself?

Then please let me know. So far I'm easiest to reach on Twitter as [@voxpelli](http://twitter.com/voxpelli).

## To install

### Locally

1. Set up a new PostgreSQL database
2. Run `npm run install-schema` to set up the tables
3. Set up the environment variables by eg. copying `sample.env` to `.env`
4. Run `foreman start` or `npm start`

### Heroku

1. Set up a new application
2. Set up a database for the new application
3. Set up environment variables using `heroku config`
4. Push up the code
5. Use a [One-Off Dyno](https://devcenter.heroku.com/articles/one-off-dynos) to set up the tables: `heroku run npm run install-schema`

## To update

### Locally

Just run `npm run migrate-schema`.

### Heroku

1. Before you push any code you may want to activate the [Maintenance Mode](https://devcenter.heroku.com/articles/maintenance-mode) if it is a breaking update
2. Push the new code and let Heroku deploy it
3. Use a [One-Off Dyno](https://devcenter.heroku.com/articles/one-off-dynos) to do the migration: `heroku run npm run migrate-schema`
4. If you activated the [Maintenance Mode](https://devcenter.heroku.com/articles/maintenance-mode) – then remember to deactivate it as well

## Revert an update

Just run `npm run rollback-schema` locally or, if on Heroku, use a [One-Off Dyno](https://devcenter.heroku.com/articles/one-off-dynos) to do the rollback: `heroku run npm run rollback-schema` And afterwards – of course make sure that you also revert your code to a version that matches the schema – but you already knew that of course :)

## Environment variables

You can set these up locally by simply copying `sample.env` to `.env` and changing the values in that file.

### Required

* **DATABASE_URL** - a configuration URL for the PostgreSQL database
* **WEBMENTIONS_COOKIE_SECRET** - a secret for the cookie that will make sure a user stays logged in
* **WEBMENTIONS_GITHUB_ID** - a GitHub OAuth consumer id, used for logging in with GitHub
* **WEBMENTIONS_GITHUB_SECRET** - a GitHub OAuth consumer secret
* **WEBMENTIONS_HOSTNAME** - the hostname of the place your hosting the application on. Used when eg. constructing the callback URL sent to the GitHub API.

### Optional

* **WEBMENTIONS_USER_LIMIT** - the total maximum of users you want to be able to use your application. Defaults to 6.
* **WEBMENTIONS_DEV_THROTTLING** – in a development environment, enables throttling for local pings made by eg. [webmention-testpinger](https://www.npmjs.org/package/webmention-testpinger) – needed to test throttling mechanism
* **WEBMENTIONS_DEV_SIGINT_CLEANUP** – enables graceful shutdown on `SIGINT` command
* **NEW_RELIC_LICENSE_KEY** - the license key for New Relic, if you want to use that
* **NEW_RELIC_ENABLED** - set to true if you want to use New Relic

## Requirements

* Node.js
* PostgreSQL (or possibly any other Knex-compatible database like MySQL/MariaDB, SQLite)
* ([Foreman](http://ddollar.github.io/foreman/) – optional, but recommended in a development environment as this project is built around the `Procfile` and `.env` files that it and Heroku uses. Currently only one process is used though and a backup `.env` parser is provided so not needed.)

## Try it out locally

Install [webmention-testpinger](https://github.com/voxpelli/node-webmention-testpinger) then do:

```bash
webmention-testpinger --endpoint=http://127.0.0.1:5000/api/webmention --target=http://127.0.0.1:5000/
```


## License
[![FOSSA Status](https://app.fossa.io/api/projects/git%2Bgithub.com%2Fvoxpelli%2Fwebpage-webmentions.svg?type=large)](https://app.fossa.io/projects/git%2Bgithub.com%2Fvoxpelli%2Fwebpage-webmentions?ref=badge_large)
