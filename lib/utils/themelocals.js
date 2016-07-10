'use strict';

const prettyDate = function (time) {
  time = typeof time === 'string' ? parseInt(time, 10) : time;
  const date = new Date(time);
  const diff = (((new Date()).getTime() - date.getTime()) / 1000);
  const dayDiff = Math.floor(diff / 86400);

  if (isNaN(dayDiff)) { return ''; }
  if (dayDiff < 0) { return date.toLocaleString(); }

  return (dayDiff === 0 && (
      (diff < 60 && 'just now') ||
      (diff < 120 && '1 minute ago') ||
      (diff < 3600 && Math.floor(diff / 60) + ' minutes ago') ||
      (diff < 7200 && '1 hour ago') ||
      (diff < 86400 && Math.floor(diff / 3600) + ' hours ago'))) ||
    (dayDiff === 1 && 'Yesterday') ||
    (dayDiff < 7 && dayDiff + ' days ago') ||
    (dayDiff < 365 && Math.ceil(dayDiff / 7) + ' weeks ago') ||
    Math.ceil(dayDiff / 365) + ' years ago';
};

module.exports = {
  prettyDate
};
