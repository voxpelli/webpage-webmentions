## Changelog

### 0.12.3

* **Bug fix:** Reject invalid source and target URL:s

### 0.12.2

* **Bug fix:** Avoid circular loops when looking up comments that are comments of each other
* **Improvement:** Never queue up more than a single instance of each message per URL

### 0.12.1

* Fixed some bugs
* Updated some dependencies
* Added a Yarn lock file

### 0.12.0

**Breaking change** – now requires Node.js 6.x or newer

### 0.11.4

** NOTE: Might require Node 6 **

* Fix: Updated dependencies, mainly moved away from Lodash 2 to built in ES6 methods in combination with standalone Lodash methods (which will likely be phased out one by one later on)

### 0.11.3

* Fix: Hardened the app

### 0.11.2

* Fix: Removed caching of query responses meant to avoid errors on database outages. Caused bugs and didn't work as intended.

### 0.11.1

* Fix: Noted in changelog that 0.11.0 needed a database migration
* Fix: Restored graceful shutdown

### 0.11.0

**Breaking change** – now requires Node.js 5.x or newer
**Hosts needs to do a database migration**.

* Fix: Make compatible with Node.js 5.x and newer
* Fix: Use latest version of the [microformat parser](https://github.com/glennjones/microformat-node)
* Refactor: Large refactoring of the code base to be split up into smaller parts
* Refactor: Extracted the parsing into a [standalone module](https://github.com/voxpelli/metadataparser-mf2) that sits on top of [metadataparser](https://github.com/voxpelli/metadataparser/)
* Change: Updated the dev tools. Now eg. use [ESLint](http://eslint.org/) and [Semistandard](https://github.com/Flet/semistandard) to enforce coding standards.
* Sneak peek: Basic work done for [Salmention](https://indieweb.org/salmention) support. Still not ready for full release though. Progress is tracked in the [Salmention issue](https://github.com/voxpelli/webpage-webmentions/issues/21).

### 0.10.0

* Feature: A new experimental "u-responses" based embed script that progressively enhances "u-responses" that points to the curlable page introduced in `0.9.0` by replacing those links with actual embedded mentions fetched with ajax. This ensures the curlability of the full chain from `h-entry` to received mentions.
* Fix: Restored realtime functionality of cutting edge embeds.
* Refactor: Moved all remaining HTML-pages to the new theme system to keep the page layouts more DRY
* Improvement: All standalone javascripts are now minified

### 0.9.1

* Fix: Restored node.js 0.12 compatibility

### 0.9.0

**Breaking change** – now requires Node.js 0.12 or iojs (iojs prefered). This project no longer supports Node.js 0.10.

* Feature: Moving towards fixing the [curlability](https://indiewebcamp.com/curlability) of the endpoint by introducing standalone microformatted HTML-pages for all mentions lists. This makes it possible to eg. subscribe to mentions of a page just like one would subscribe to any [h-feed / h-entry](https://indiewebcamp.com/h-feed) and can also be extended further to enable better integrations with the rest of the community.
* Refactor: Moved to a full theme system, using [Tema](https://github.com/voxpelli/node-tema), to enable the reuse of layouts between HTML-pages and generally make the HTML output simpler.
* Refactor: Removed the Promise polyfill. This was also done in some of the dependencies of this project. This means this project now requires a Node.js-version that has Promise support built in and will going forward use any other modern features of these newer versions as well.
* Fix: Updated lots of dependencies + deduped dependencies

### 0.8.1

* Feature: Multi-URL cutting edge embeds now mentions what URL:s a mention was received for. This is useful for eg. a Twitter-style mentions page. Possible to opt out of through the new `nocontext` query parameter.

### 0.8.0

**Hosts needs to do a database migration**. People not hosting this site themselves don't have to do anything though – embeds etc are working just like before.

* Update: The microformat and HTML parsing libraries has been updated to new version
* Update: A new column that tracks the version of the microformat library used has been added, makes it easier to migrate and/or update data in the future
* Fix: By default there's again no longer any throttling when pinging localhost sites to a development instance

### 0.7.3

* Feature: One can now add a `sort=desc` query parameter when embedding or fetching mentions to reverse the sort order
* Fix: Updated lots of dependencies

### 0.7.2

* Change: Move to iojs as main node runtime
* Fix: A bug that made sites with no mentions not show when logged in
* Fix: Updated lots of dependencies
* Tests: Fix for out of order returns of mocked requests when running on iojs

### 0.7.1

* Fix: No more warnings in the logs about too many listeners
* Fix: New Relic will now log request parameters, which will make it easier to understand certain errors

### 0.7.0

**Hosts needs to do a database migration**. People not hosting this site themselves don't have to do anything though – embeds etc are working just like before.

* Improvement: Now using a database backed throttling mechanism, based on [fetch-politely](https://github.com/voxpelli/node-fetch-politely), which means no more limits to how many source URL:s can be queued for lookup
* Change: Disabled sync-pinging outside of development and test environments as its incompatible with the new throttling
* Change: Added option, `WEBMENTIONS_DEV_SIGINT_CLEANUP`, to graceful shutdown on `SIGINT`
* Fix: Got graceful shutdown working again
* Fix: Updated dependencies

### 0.6.1

Updated dependencies to eg. address the [Open Redirect](https://nodesecurity.io/advisories/serve-static-open-redirect) security advisory on the `express`-submodule `serve-static`

### 0.6.0

**Hosts needs to do a database migration**. People just using the embed are of course fine though – will never break an embed.

* Fix: Take the [base](https://developer.mozilla.org/docs/Web/HTML/Element/base)-tag into consideration when resolving all relative URL:s
* Fix: Accept multiple mentions from the same source
* Improvement: Updating mention content and removing outdated mentions on valid pings (can't yet remove the mention from a page)
* Improvement: Mentions are now updated and removed in realtime from `cutting-edge` embeds – will likely be back-ported eventually to the legacy embeds

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
