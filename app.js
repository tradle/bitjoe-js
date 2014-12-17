
'use strict';

var express = require('express');
var bodyParser = require('body-parser');
var app = express();
var Joe = require('./');
var config = require('./conf/config.json');
var joe = new Joe(config);
var log = console.log.bind(console);

app.set('joe', joe);

joe.on('ready', function() {
  console.log('Send coins to ' + joe.kit().currentReceiveAddress());
  console.log('Balance: ' + joe.kit().getBalance());

  app.listen(config.address.port);
});

app.use(bodyParser.urlencoded({ extended: true })); // for parsing application/x-www-form-urlencoded
app.use(function onready(req, res, next) {
  if (!joe.isReady()) 
    return joe.on('ready', next);
  else 
    next();
})

/**
 * Routes
 */
require('./lib/router')(app);

/**
 * Error Handling
 */
app.use(function(err, req, res, next) {
  var code = err.status || 500;
  var msg = 'status' in err ? err.message : 'There was an error with your request. Please contact support@tradle.io';

  log('Error:', err);
  res.status(code).json({
    code: code,
    message: msg
  }, null, 2);
});

module.exports = app;