(function ($) {
  "use strict";

  var checkLoginStatus, checkSites;

  checkLoginStatus = function () {
    $.getJSON('/user/status', function (data) {
      if (data.loggedin) {
        $('.receive li.first-step ul').replaceWith($('<p />').text('Done! ').append($('<a />', {
          href : '/user/logout',
          text : 'Log out?'
        })))
        checkSites();
      } else {
        if (data.accountsAvailable !== undefined) {
          $('<p />', {
            "class": "accounts-available",
            text : '(' + data.accountsAvailable + ' accounts left at the moment)'
          }).insertAfter('.receive li.first-step > ul');
        }
        $('.receive li.second-step form').remove();
        if (data.dev) {
          $('<a />', {
            href : '/user/auth/dummy',
            text : "Since you're in a dev environment you can bypass online sign ins here!"
          }).appendTo('.receive li.first-step ul').wrap('<li />');
        }
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

  $('textarea').on('mouseup', function () {
      $(this).select();
  }).each(function () {
    var $this = $(this);
    $this.val($this.val().replace('"http://example.com', '"' + window.location.protocol + '//' + window.location.host));
  });
}($));
