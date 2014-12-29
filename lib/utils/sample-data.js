"use strict";

var faker = require('faker');

module.exports = {
  mentions: function (count) {
    count = count || 4;

    var mentions = [], i, author;

    for (i = 0; i < count; i++) {
      author = !i || faker.random.number(4);
      mentions.push({
        author: {
          name: author ? faker.name.findName() : null,
          photo: (!i || (author && faker.random.number(2))) ? faker.image.avatar() : null,
          url: (!i || (author && faker.random.number(3))) ? 'http://' + faker.internet.domainName() + '/' : null
        },
        name: (!i || faker.random.number(6)) ? null : faker.lorem.words(1 + faker.random.number(4)).join(' '),
        published: new Date(faker.date.recent(30)).getTime(),
        summary: faker.lorem.paragraph(),
        url: 'http://' + faker.internet.domainName() + '/' + faker.lorem.words(1 + faker.random.number(4)).join('/'),
        targets: ['http://example.com/']
      });
    }

    return mentions;
  }
};
