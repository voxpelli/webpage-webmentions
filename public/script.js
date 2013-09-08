(function ($) {
  "use strict";

  var checkLoginStatus, checkSites;

  checkLoginStatus = function () {
    $.getJSON('/user/status', function (data) {
      if (data.loggedin) {
        $('.receive li.first-step ul').replaceWith($('<p />').text('Done!'))
        checkSites();
      } else {
        $('.receive li.second-step form').remove();
      }
    });
  };

  checkSites = function () {
    $.getJSON('/user/sites', function (data) {
      var $list = $('<ul />');
      $.each(data.sites, function (i, value) {
        $('<li />').text(value).appendTo($list);
      });
      $list.insertBefore('.receive li.second-step form');
    });
  };

  checkLoginStatus();
}($));
