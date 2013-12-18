# A WebMention Endpoint

A site that receives and embeds [WebMentions](http://indiewebcamp.com/webmention) for other sites

## Usage

### Locally

1. Set up a new PostgreSQL database by importing `tables.sql`
2. Copy `sample.env` to `.env` and set up the environment variables
3. Run `foreman start`

### Heroku

1. Set up a new application
2. Set up a database for the new application
2. Set up environment variables using `heroku config`
3. Push up the code

## Environment variables

Set these up locally by copying `sample.env` to `.env` and changing the values in there

### Required

* **DATABASE_URL** - a configuration URL for a PostgreSQL database
* **WEBMENTIONS___COOKIE___SECRET** - a secret for the cookie that will make sure a user stays logged in
* **WEBMENTIONS___GITHUB___ID** - a GitHub OAuth consumer id, used for logging in with GitHub
* **WEBMENTIONS___GITHUB___SECRET** - a GitHub OAuth consumer secret
* **WEBMENTIONS_HOSTNAME** - the hostname of the place your hosting the application on

### Optional

* **WEBMENTIONS___USER___LIMIT** - the total maximum of users you want to be able to use your application

## Requirements

* Node.js
* PostgreSQL
* [Foreman](http://ddollar.github.io/foreman/) (can be avoided, but is highly recommended)

## Changelog

### 0.1.0

* First version
