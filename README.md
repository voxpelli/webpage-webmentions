# A WebMention Endpoint

A site that receives and embeds [WebMentions](http://indiewebcamp.com/webmention) for other sites. makes the WebMentions embeddable through a javascript, similar to how eg. Disqus works.

A live deploy of this can be found on [webmention.herokuapp.com](https://webmention.herokuapp.com/). One can also sign up to that one rather than deploying ones own if one likes.

## Deploying it yourself?

Then please let me know. So far I'm easiest to reach on Twitter as [@voxpelli](http://twitter.com/voxpelli).

## To install

### Locally

1. Set up a new PostgreSQL database
2. Run `npm install-schema` to set up the tables
3. Set up the environment variables by eg. copying `sample.env` to `.env`
4. Run `foreman start` or `npm start`

### Heroku

1. Set up a new application
2. Set up a database for the new application
2. Set up environment variables using `heroku config`
3. Push up the code

## To update

### Locally

Just run `npm update-schema`.

### Heroku

1. Before you push any code you may want to activate the [Maintenance Mode](https://devcenter.heroku.com/articles/maintenance-mode) if it is a breaking update
2. Push the new code and let Heroku deploy it
3. Use a [One-Off Dyno](https://devcenter.heroku.com/articles/one-off-dynos) to do the migration: `heroku run npm update-schema`
4. If you activated the [Maintenance Mode](https://devcenter.heroku.com/articles/maintenance-mode) – then remember to deactivate it as well

## Revert an update

Just run `npm rollback-schema` locally or, if on Heroku, use a [One-Off Dyno](https://devcenter.heroku.com/articles/one-off-dynos) to do the rollback: `heroku run npm rollback-schema` And afterwards – of course make sure that you also revert your code to a version that matches the schema – but you already knew that of course :)

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
* **WEBMENTIONS_DEV_THROTTLIING** – in a development environment, enables throttling for local pings made by eg. [webmention-testpinger](https://www.npmjs.org/package/webmention-testpinger) – needed to test throttling mechanism
* **NEW_RELIC_LICENSE_KEY** - the license key for New Relic, if you want to use that
* **NEW_RELIC_ENABLED** - set to true if you want to use New Relic

## Requirements

* Node.js
* PostgreSQL (or possibly any other Knex-compatible database like MySQL/MariaDB, SQLite)
* ([Foreman](http://ddollar.github.io/foreman/) – optional, but recommended in a development environment as this project is built around the `Procfile` and `.env` files that it and Heroku uses. Currently only one process is used though and a backup `.env` parser is provided so not needed.)

## Changelog

### 0.3.0

* Moved from interacting with Postgres directly to using Knex to talk with the database. Makes any SQL-database work + gives a nice migration framework and schema declaration base.
* Added a built in .env parser, dotenv, to the development environment to make sure that the site works without foreman. Needed by eg. Knex migration system as it isn't run by foreman.
* Made it possible to test throttle system locally by adding WEBMENTIONS_DEV_THROTTLIING, variable
* Apart from adding new dependencies, also updated the dev-dependencies and the shrinkwrap
* Normalizes the URL before matching target – eg. ignores trailing slashes, strips www. subdomains and treats https and http as the same

### 0.2.2

* User friendly information on GET-requests to endpoint
* Showing totalt amount of accounts on front page

### 0.2.1

* Dependency updates
* Less chatty NewRelic in the logs

### 0.2.0

* Added a way to export all mentions of a site
* Updated database schema to include the target site's hostname in the mentions table, makes it easier to look up a site's mentions
* Added mention counts to the site list
* Updated the user-agent string used when fetching webmention sources
* New migration and installation system using [db-migrate](https://github.com/kunklejr/node-db-migrate)
* Bug fixes

### 0.1.2

* Expanding relative links in the source page when checking for a valid target
* Ensure graceful shutdown of database to handle Heroku environment better
* Ignore port when matching a mention's target host to registered hosts
* Do not throttle pings in development environments (useful with [webmention-testpinger](https://github.com/voxpelli/node-webmention-testpinger))

### 0.1.1

* Added New Relic diagnostics

### 0.1.0

* First version
