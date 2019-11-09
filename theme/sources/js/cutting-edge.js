'use strict';

// TODO: Allow an embed that's simply a number of responses – for use in lists

// Utility methods

var classPrefix = 'webmention-',
  each = function (collection, callback) {
    for (var i = 0, length = collection.length; i < length; i++) {
      callback(collection[i]);
    }
  },
  constructQuery = function (query) {
    return Object.keys(query).map(function (key) {
      return [].concat(query[key]).map(function (value) {
        return encodeURIComponent(key) + '=' + encodeURIComponent(value);
      }).join('&');
    }).join('&');
  },
  parseQuery = function (query) {
    var result = {};
    each(query.split('&'), function (keyValuePair) {
      keyValuePair = keyValuePair.split('=');
      var key = decodeURIComponent(keyValuePair[0]);
      var value = keyValuePair[1] ? decodeURIComponent(keyValuePair[1]) : true;
      result[key] = result[key] ? [].concat(result[key], value) : value;
    });
    return result;
  },
  ajax = function (url, query, callback) {
    var xhr = new XMLHttpRequest();
    if (query) {
      url = url + '?' + constructQuery(query);
    }
    xhr.open('GET', url);
    xhr.onload = function () {
      if (xhr.status !== 200) { return callback(new Error('Received status code ' + xhr.status)); }
      callback(undefined, JSON.parse(xhr.responseText));
    };
    xhr.send();
  },
  floor = function (number) {
    return Math.floor(number);
  },
  appendChild = function (elem, child) {
    elem.appendChild(child);
  },
  parentNode = function (elem) {
    return elem.parentNode;
  },
  hasClass = function (elem, className) {
    return elem.className.indexOf(classPrefix + className) !== -1;
  },
  addClass = function (elem, className) {
    className = classPrefix + className;
    if (elem.className !== '') {
      if ((new RegExp('(^|\\s)' + className + '($|\\s)')).test(elem.className)) { return; }
      elem.className += ' ';
    }
    elem.className += className;
  },
  createChild = function (elem, tag, className, oldElem) {
    var newElem = document.createElement(tag);
    if (oldElem) {
      elem.replaceChild(newElem, oldElem);
    } else if (elem) {
      appendChild(elem, newElem);
    }
    if (className) { addClass(newElem, className); }
    return newElem;
  },
  interactionPresentation = {
    'like': 'liked',
    'repost': 'reposted'
  },
  addText = function (tag, text) {
    appendChild(tag, document.createTextNode(text));
  },
  imgOnError = function () { addClass(this, 'error'); },
  addImage = function (container, src) {
    var elem;
    if (src) {
      elem = createChild(container, 'img');
      elem.loading = 'lazy';
      elem.onerror = imgOnError;
      elem.src = src;
    }
  },
  addTextList = function (elem, items) {
    var i, length, list = new DocumentFragment();

    for (i = 0, length = items.length; i < length; i++) {
      if (i !== 0) {
        addText(list, i === length - 1 ? ' and ' : ', ');
      }
      appendChild(list, items[i]);
    }

    appendChild(elem, list);
  },
  attr = function (elem, key, value) {
    if (!value) {
      return elem.getAttribute('data-' + key);
    }
    elem.setAttribute('data-' + key, value);
  },
  eachSelector = function (container, selector, callback) {
    each(container.querySelectorAll(selector), callback);
  },
  eachElem = function (container, selector, callback) {
    eachSelector(container, '.' + classPrefix + selector, callback);
  },
  prettyDate = function (time) {
    time = typeof time === 'string' ? parseInt(time, 10) : time;
    var date = new Date(time),
      diff = (((new Date()).getTime() - date.getTime()) / 1000),
      dayDiff = floor(diff / 86400);

    if (isNaN(dayDiff)) { return ''; }
    if (dayDiff < 0) { return date.toLocaleString(); }

    return (dayDiff === 0 && (
        (diff < 60 && 'just now') ||
        (diff < 120 && '1 minute ago') ||
        (diff < 3600 && floor(diff / 60) + ' minutes ago') ||
        (diff < 7200 && '1 hour ago') ||
        (diff < 86400 && floor(diff / 3600) + ' hours ago'))) ||
      (dayDiff === 1 && 'Yesterday') ||
      (dayDiff < 7 && dayDiff + ' days ago') ||
      (dayDiff < 365 && Math.ceil(dayDiff / 7) + ' weeks ago') ||
      Math.ceil(dayDiff / 365) + ' years ago';
  };

// Embed specific methods

var uResponsesRegexp = /^(https?:\/\/[^\/]+)\/api\/mentions\?/,
  addMention = function (container, mention, oldBox) {
    var box, author, footer, published, interactions, mentions, targetUrl, target, i, length;

    mention.author = mention.author || {};

    if (interactionPresentation[mention.type]) {
      mention.author.name = mention.author.name || 'Someone';
      mention.name = null;
      mention.summary = interactionPresentation[mention.type] + (mention.interactionTarget ? ' this' : ' something');
    }

    box = createChild(container, 'div', 'mention', oldBox);

    author = createChild(createChild(box, 'div', 'author'), mention.author.url ? 'a' : 'span');
    if (mention.author.url) {
      author.href = mention.author.url;
    }
    addImage(author, mention.author.photo);
    addText(author, mention.author.name || 'Unknown');

    if (mention.name) {
      addText(createChild(box, 'div', 'name'), mention.name);
    }
    if (mention.summary) {
      addText(createChild(box, 'div', 'summary'), mention.summary);
    }

    footer = createChild(box, 'div', 'footer');

    published = createChild(footer, 'a', 'published');
    attr(published, 'published', mention.published);
    addText(published, prettyDate(mention.published));
    published.href = mention.url;

    if (!attr(container, 'nocontext')) {
      interactions = [];
      mentions = [];

      for (i = 0, length = mention.targets.length; i < length; i++) {
        targetUrl = mention.targets[i];

        target = createChild(false, 'a', 'target');
        addText(target, targetUrl);
        target.href = targetUrl;

        (mention.interactions.indexOf(targetUrl) === -1 ? mentions : interactions).push(target);
      }

      if (interactions.length) {
        addText(footer, ' in response to ');
        addTextList(footer, interactions);
        if (mentions.length) {
          addText(footer, ' and ');
        }
      }
      if (mentions.length) {
        addText(footer, ' mentioning ');
        addTextList(footer, mentions);
      }
    }
  },
  getFacepile = function (container, create) {
    var facepile = container.querySelector('.' + classPrefix + 'facepile');

    if (!facepile && create !== false) {
      facepile = createChild(false, 'ul', 'facepile');

      if (container.childNodes.length === 0) {
        appendChild(container, facepile);
      } else {
        container.insertBefore(facepile, container.childNodes[0]);
      }
    }

    return facepile;
  },
  addInteraction = function (container, mention, oldBox) {
    var facepile = getFacepile(container),
      interaction, wrapper, href, text;

    mention.author = mention.author || {};

    if (mention.author.url && mention.type === 'like') {
      href = mention.author.url;
    } else {
      href = mention.url;
    }

    text = mention.author.name || 'Someone';
    text += ' ' + interactionPresentation[mention.type] + ' this ' + prettyDate(mention.published);

    interaction = createChild(
      createChild(facepile, 'li', 'interaction-' + mention.type, oldBox),
      href ? 'a' : 'span',
      'interaction-presentation'
    );

    attr(interaction, 'url', mention.url);
    interaction.title = text;
    interaction.href = href;

    wrapper = createChild(interaction, 'span');
    addImage(wrapper, mention.author.photo);
    addText(wrapper, text);
  },
  getMention = function (container, url) {
    var escapedUrl = url.replace('"', '%22');
    var elem = container.querySelector('.' + classPrefix + 'published[href="' + escapedUrl + '"]');
    var facepile;
    if (!elem) {
      facepile = getFacepile(container, false);
      if (facepile) {
        elem = facepile.querySelector('.' + classPrefix + 'interaction-presentation[data-url="' + escapedUrl + '"]');
      }
    }
    if (elem) {
      while ((elem = parentNode(elem))) {
        if (hasClass(parentNode(elem), 'container') || hasClass(parentNode(elem), 'facepile')) {
          break;
        }
      }
    }
    return elem;
  },
  listenForUpdates = function (container, query) {
    if (!EventSource) {
      return;
    }

    var baseUrl = attr(container, 'baseUrl');
    var nofacepile = attr(container, 'nofacepile');

    query = constructQuery(query);

    var updateListener = function (retries) {
      retries = retries || 0;
      var updates = new EventSource(baseUrl + '/api/mentions/live?' + query);
      updates.onerror = function () {
        if (updates.readyState === 2) {
          setTimeout(
            updateListener.bind(undefined, Math.min(5, retries + 1)),
            500 + (floor(1000 * Math.pow(1.5, retries) * Math.random()))
          );
        }
      };
      updates.addEventListener('mention', function (e) {
        var mention, mentionBox;
        try {
          mention = JSON.parse(e.data);
        } catch (ignore) {}
        if (mention) {
          mentionBox = getMention(container, mention.url);
        }
        if (mention && mention.targets.length) {
          eachElem(container, 'published', function (elem) {
            elem.childNodes[0].nodeValue = prettyDate(attr(elem, 'published'));
          });
          if (nofacepile || !interactionPresentation[mention.type]) {
            addMention(container, mention, mentionBox);
          } else {
            addInteraction(container, mention, mentionBox);
          }
        } else if (mention && mention.removedTargets.length) {
          if (mentionBox) {
            parentNode(mentionBox).removeChild(mentionBox);
          }
        }
      });
    };
    updateListener();
  },
  initMentions = function (mentions, options) {
    var container = createChild(false, 'div', 'container');

    each(Object.keys(options), function (key) {
      attr(container, key, options[key]);
    });

    each(mentions, function (mention) {
      (mention.interactionTarget && interactionPresentation[mention.type] && !options.nofacepile ? addInteraction : addMention)(container, mention);
    });

    return container;
  },
  loadMentions = function (injectionPoint, callback) {
    var url = injectionPoint.href;
    var match = uResponsesRegexp.exec(url);

    if (!match) { return callback(new Error('Invalid URL')); }

    var baseUrl = match[1];
    var query = parseQuery(url.slice(url.indexOf('?') + 1));

    delete query.format;

    var options = {};

    if (query.nocontext || (!query.site && !query.path && (!query.url || !Array.isArray(query.url)))) {
      options.nocontext = true;
    }

    each(Object.keys(query), function (key) {
      if (['site', 'url', 'path', 'example'].indexOf(key) === -1) {
        options[key] = query[key];
      }
    });

    options.baseUrl = baseUrl;

    ajax(baseUrl + '/api/mentions', query, function (err, result) {
      if (err) { return callback(err); }

      var container = initMentions(result, options);

      callback(undefined, container);

      listenForUpdates(container, query);
    });
  },
  findNewInjectionPoints = function (container) { // jshint ignore:line
    eachSelector(container || document, '.u-responses', function (injectionPoint) {
      injectionPoint.className += ' ' + classPrefix + 'loading';
      loadMentions(injectionPoint, function (err, mentions) {
        if (err) {
          injectionPoint.className = injectionPoint.className.replace(classPrefix + 'loading', classPrefix + 'error');
        } else {
          parentNode(injectionPoint).replaceChild(mentions, injectionPoint);
        }
      });
    });
  },
  publicMethods = { // eslint-disable-line no-unused-vars
    loadMentions: loadMentions,
    findNewInjectionPoints: findNewInjectionPoints
  };
