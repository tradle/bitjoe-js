
'use strict';

var assert = require('assert');
var request = require('request');
var querystring = require('querystring');
var pubsub = require('./pubsub');
// var common = require('./common');

var hooks = {
  url: {},
  event: {}
};

function addHooks(url/* [event1, event2, ...] */) {
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

function removeHooks(url/* [event1, event2, ...] */) {
  assert(url, 'url is required');

  var hooksForUrl = hooks.url[url];
  if (!hooksForUrl) return;

  var events = arguments.length === 1 ? Object.keys(hooks.event) : [].slice.call(arguments, 1);

  for (var i = 0; i < events.length; i++) {
    var event = events[i];
    hooksForUrl.remove(event);
    var urls = hooks.event[event];
    if (urls) urls.remove(url);
  }
}

pubsub.on('hooks:add', addHooks);
pubsub.on('hooks:remove', removeHooks);
pubsub.on('newentry', function(key, value) {
  var newentryHooks = hooks.event.newentry;
  if (!newentryHooks)
    return;

  var query = querystring.stringify({ key: key, value: value });
  newentryHooks.forEach(function(url) {
    request(url + '?' + query);
  });
});

pubsub.on('newpermission', function(permission) {
  var newpermissionHooks = hooks.event.newpermission;
  if (!newpermissionHooks)
    return;

  var query = querystring.stringify(permission);
  newpermissionHooks.forEach(function(url) {
    request(url + '?' + query);
  });
});