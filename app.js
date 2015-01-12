
'use strict';

var Joe = require('./');
var pubsub = require('./lib/pubsub');
var fs = require('fs');
var path = require('path');
var debug = require('debug')('bitjoe-app');
var config;
if (process.argv[2]) {
  var configPath = path.join(__dirname, process.argv[2]);
  config = fs.readFileSync(configPath, { encoding: 'utf8' });
  config = JSON.parse(config);
}
else
  config = require('./conf/config');

var joe = new Joe(config);
joe.on('ready', function() {
  debug('ready');
});

pubsub.on('file', function() {

});

pubsub.on('file:shared', function(info) {
  debug('put: ' + info.key + ' -> ' + info.value);
});