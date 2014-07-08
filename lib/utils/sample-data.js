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
          name: author ? faker.Name.findName() : null,
          photo: (!i || (author && faker.random.number(2))) ? faker.Image.avatar() : null,
          url: (!i || (author && faker.random.number(3))) ? 'http://' + faker.Internet.domainName() + '/' : null
        },
        name: (!i || faker.random.number(6)) ? null : faker.Lorem.words(1 + faker.random.number(4)).join(' '),
        published: new Date(faker.Date.recent(30)).getTime(),
        summary: faker.Lorem.paragraph(),
        url: 'http://' + faker.Internet.domainName() + '/' + faker.Lorem.words(1 + faker.random.number(4)).join('/')
      });
    }

    return mentions;
  }
};
