'use strict';

var assert = require('assert');
var querystring = require('querystring');
var http = require('http');
// var pubsub = require('../pubsub');
// var common = require('./common');

module.exports = function(joe) {
  var hooks = {
    url: {},
    event: {}
  };

  function addHooks(url /* [event1, event2, ...] */ ) {
    assert(url && arguments.length > 2, 'a callback url and at least one event are required')

    var hooksForUrl = hooks.url[url];
    if (!hooksForUrl)
      hooksForUrl = hooks.url[url] = [];

    // if (hooksForUrl && hooksForUrl.indexOf(event) !== -1)
    //   throw common.httpError(409, 'Hook already exists for event ' + event + ' and url ' + url);

    for (var i = 1; i < arguments.length; i++) {
      var event = arguments[i];
      hooksForUrl.push(event);
      var hooksForEvent = hooks.event[event];
      if (!hooksForEvent)
        hooksForEvent = hooks.event[event] = [];

      hooksForEvent.push(url);
    }
  }

  function removeHooks(url /* [event1, event2, ...] */ ) {
    assert(url, 'url is required');

    var hooksForUrl = hooks.url[url];
    if (!hooksForUrl) return;

    var events = arguments.length === 1 ? Object.keys(hooks.event) : [].slice.call(arguments, 1);

    for (var i = 0; i < events.length; i++) {
      var event = events[i];
      var idx = hooksForUrl.indexOf(event);
      if (idx !== -1) hooksForUrl.splice(idx, 1);

      var urls = hooks.event[event];
      if (urls) {
        idx = urls.indexOf(url);
        if (idx !== -1) urls.splice(idx, 1);
      }
    }
  }

  joe.on('entry', function(key, value, blockHeight) {
    var newentryHooks = hooks.event.newentry;
    if (!newentryHooks)
      return;

    var query = querystring.stringify({
      key: key,
      value: value
    });

    newentryHooks.forEach(function(url) {
      http.request(url + '?' + query);
    });
  });

  joe.on('newpermission', function(permission) {
    var newpermissionHooks = hooks.event.newpermission;
    if (!newpermissionHooks)
      return;

    var query = querystring.stringify(permission);
    newpermissionHooks.forEach(function(url) {
      http.request(url + '?' + query);
    });
  });

  return {
    addHooks: addHooks,
    removeHooks: removeHooks
  }
}
