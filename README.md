# A WebMention Endpoint

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
* **NEW_RELIC_LICENSE_KEY** - the license key for New Relic, if you want to use that
* **NEW_RELIC_ENABLED** - set to true if you want to use New Relic

## Requirements

* Node.js
* PostgreSQL (or possibly any other Knex-compatible database like MySQL/MariaDB, SQLite)
* ([Foreman](http://ddollar.github.io/foreman/) – optional, but recommended in a development environment as this project is built around the `Procfile` and `.env` files that it and Heroku uses. Currently only one process is used though and a backup `.env` parser is provided so not needed.)

## Changelog

### 0.6.0

* Fix: Take the [base](https://developer.mozilla.org/docs/Web/HTML/Element/base)-tag into consideration when resolving all relative URL:s
* Fix: Accept multiple mentions from the same source
* Improvement: Updating mention content and removing outdated mentions on valid pings (can't yet remove the mention from a page)

### 0.5.2

* Fix: Quick workaround for duplicated interaction texts. Works until a more proper fix for #10 is in place.
* Improvement: Increased example mentions from 4 to 14

### 0.5.1

* Feature: Added a new experimental `interactions` query parameter to the `/api/mentions` endpoint. Enables custom facepile-solutions.
* Improvement: Link to the posts rather than author in facepiles for repost interactions and author-url-less posts
* Improvement: Added interaction support to example mentions
* Improvement: Some minor style changes to the website
* Fix: Now falls back correctly to UTC for timezone-less publish times (best solution for now until a more proper timezone can be resolved for those)

### 0.5.0

* Feature: Now parses the [interactions](http://indiewebcamp.com/interactions) of mentions. **Requires database migration**, but is otherwise backwards compatible
* Feature: New `cutting-edge` embed that features a [facepile](http://indiewebcamp.com/facepile) of [like](http://indiewebcamp.com/like) and [repost](http://indiewebcamp.com/repost) interactions. This embed is experimental and no changes to it will be considered as breaking changes. Successful new features will find their way into new stable embed versions.
* Feature: The example embed on the frontpage now uses the `cutting-edge` embed
* Improvement: Confirm the "Remove site" action to avoid accidental deletion!
* Improvement: Added more tests to ensure that mentions are parsed consistently over time
* Improvement: Added documentation of the available API:s
* Fix: Updated dependencies

### 0.4.3

* Fix: Updated dependencies
* Refactor: Some refactorings and updates made possible or required by the updated dependencies
* Improvement: Better New Relic settings to eg. ignore the EventSource endpoint when calculating response time

### 0.4.2

* Fix: The `api/mentions/live` request wasn't always closed down properly which resulted in a memory leak

### 0.4.1

* Fix: Heartbeat for EventSource at `api/mentions/live` to avoid Heroku timing it out

### 0.4.0

* Feature: Exposes an EventSource at `api/mentions/live` that notifies about new WebMentions. It accepts same arguments as `api/mentions`. Thanks @stuartlangridge for pushing this! (Built on top of PostgreSQL NOTIFY/LISTEN functionality so no new dependencies)
* Feature: The embeddable mention list implements the new EventSource to get realtime updates of new WebMentions
* Feature: Both `api/mentions` and `api/mentions/live` have received CORS-headers and can be requested from everywhere!

### 0.3.11

* Feature: Return `targets` in `api/mentions` so that one more easily can ask the API for all mentions of a site

### 0.3.10

* Feature: Synchronous pinging – to make pinging easier to debug and to make our own tests easier to run, there's now a possibility to add `?sync` to the endpoint to get it to not respond until it has fetched the site

### 0.3.9

* Security fix: All embed data is filtered from having non-http URL:s to make "javascript:" URL XSS impossible. Thanks @pierreozoux for reporting the issue! 
* Improvement: Added a Retry-After header as suggested by the HTTP docs for HTTP code 503 for when the throttle cap is reached. The Retry-After header indicates when the site is available for the client again, which is implemented as when the all of the queued fetches are expected to have been made.

### 0.3.8

* Bug fix: Shouldn't fail on pages with non-http(s) links like mailto:

### 0.3.7

* Improvement: Now sorts mentions based on their published date
* Fix: Improved auto-selection in the textareas to only auto-select if no selection as been made. Less annoying.

### 0.3.6

* Change: Separates the u-url URL from the URL of the page it was found on. u-url is used for presentation, the other URL for the rest. This increases compatibility with likes and retweets sent by Brid.gy.
* Fix: Added a normalizedUrl to the entries table and moved the unique constraint of that table to it so that duplicates are more easily avoided

### 0.3.5

* Improvement: Normalised all double slashes (eg. http://example.com/foo//bar) to ensure that there's never more than a single slash separating each level of the path in a normalized URL. This will help some matching cases.
* Fix: Hardened the lookup mechanism a bit
* Change: Only redirects to HTTPS on GET-requests as redirects of POST:s should generally be done with a lot more care, so better with an error message than a helpful redirect in those cases.

### 0.3.4

* Many new options for selecting which mentions to embed. Can now specify multiple URL:s as well as instead of or in addition to that specify one or many sites to include all mentions of and/or one or many paths for which all mentions of that or to a subpath of that should be included. For more info see the new /documentation.html

### 0.3.3

* Added sample data in the API and in the tests. Can now embed sample data by using /api/embed?example rather than /api/embed?url=...
* Updated the documentation on the site, restructured it a bit and added an FAQ-section mentioning the above sample data

### 0.3.2

* Ignore fragments when matching URL:s – http://example.com/#foo and http://example.com/ should be treated the same. Thanks for the report @hugoroy!

### 0.3.1

Apart from all of the bigger changes in the latest release:

* Now normalizing also the embed URL:s so that you get the same result, no matter what target a mention was at and no matter if your site can be accessed across a few different variations of the same URL. This change requires a migration.
* Minor: Added a migration to drop the old migration table

### 0.3.0

* Moved from interacting with Postgres directly to using Knex to talk with the database. Makes any SQL-database work + gives a nice migration framework and schema declaration base.
* Added a built in .env parser, dotenv, to the development environment to make sure that the site works without foreman. Needed by eg. Knex migration system as it isn't run by foreman.
* Made it possible to test throttle system locally by adding WEBMENTIONS_DEV_THROTTLING, variable
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
