'use strict';

var faker = require('faker');

module.exports = {
  mentions: function (count, options) {
    count = count || 4;
    options = options || {};

    var mentions = [], i, j, jl, author, mention;

    for (i = 0; i < count; i++) {
      author = !i || faker.random.number(4);
      mention = {
        author: {
          name: author ? faker.name.findName() : null,
          photo: (!i || (author && faker.random.number(2))) ? faker.image.avatar() : null,
          url: (!i || (author && faker.random.number(3))) ? 'http://' + faker.internet.domainName() + '/' : null
        },
        name: (!i || faker.random.number(6)) ? null : faker.lorem.words(1 + faker.random.number(4)).join(' '),
        published: new Date(faker.date.recent(30)).getTime(),
        summary: faker.lorem.paragraph(),
        url: 'http://' + faker.internet.domainName() + '/' + faker.lorem.words(1 + faker.random.number(4)).join('/'),
        targets: ['http://example.com/'],
        type: 'mention',
        interactions: []
      };

      if (options.interactions === true || !faker.random.number(1)) {
        if (options.interactions === true) {
          mention.type = faker.random.array_element(['like', 'repost']);
        } else if (options.interactions === false) {
          mention.type = 'reply';
        } else {
          mention.type = faker.random.array_element(['like', 'repost', 'reply']);
        }

        jl = faker.random.number(3) + 1;
        if (options.interactions === true || !faker.random.number(1)) {
          jl -= 1;
          mention.interactions.push('http://example.com/');
        }
        for (j = 0; j < jl; j++) {
          mention.interactions.push('http://' + faker.internet.domainName() + '/' + faker.lorem.words(1 + faker.random.number(4)).join('/'));
        }
      }

      mentions.push(mention);
    }

    return mentions;
  }
};
