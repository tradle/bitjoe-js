
'use strict';

var assert = require('assert');
var request = require('request');
var querystring = require('querystring');

function KeeperAPI(config) {
  this._host = config.host;
  this._port = config.port;
}

KeeperAPI.prototype.baseUrl = function() {
  return this._host + ':' + this._port + '/';
}

KeeperAPI.prototype.put = function(key, value, callback) {
  assert(typeof key === 'string' && typeof value === 'string', 'key and value must be strings');

  var url = this.baseUrl() + 'put?' + querystring.stringify({
    key: key,
    val: value
  });

  return request(url, callback);
}

KeeperAPI.prototype.get = function(key, callback) {
  var url = this.baseUrl() + 'get?' + querystring.stringify({
    key: key
  });

  return request(url, callback);
}

module.exports = KeeperAPI;