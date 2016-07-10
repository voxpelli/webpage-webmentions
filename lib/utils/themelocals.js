'use strict';

var prettyDate = function (time) {
  time = typeof time === 'string' ? parseInt(time, 10) : time;
  var date = new Date(time),
    diff = (((new Date()).getTime() - date.getTime()) / 1000),
    day_diff = Math.floor(diff / 86400);

  if (isNaN(day_diff)) { return ''; }
  if (day_diff < 0) { return date.toLocaleString(); }

  return (day_diff === 0 && (
      (diff < 60 && 'just now') ||
      (diff < 120 && '1 minute ago') ||
      (diff < 3600 && Math.floor(diff / 60) + ' minutes ago') ||
      (diff < 7200 && '1 hour ago') ||
      (diff < 86400 && Math.floor(diff / 3600) + ' hours ago'))) ||
    (day_diff === 1 && 'Yesterday') ||
    (day_diff < 7 && day_diff + ' days ago') ||
    (day_diff < 365 && Math.ceil(day_diff / 7) + ' weeks ago') ||
    Math.ceil(day_diff / 365) + ' years ago';
};

module.exports = {
  prettyDate: prettyDate
};
