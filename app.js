
'use strict';

var express = require('express');
var bodyParser = require('body-parser');
var app = express();
var Joe = require('./');
var config = require('./conf/config.json');
var joe = new Joe(config);
var log = console.log.bind(console);
var common = require('./lib/common');
var domain = require('domain');

function errorHandler(err, req, res, next) {
  var code = err.status || 500;
  var msg = 'status' in err ? err.message : 'There was an error with your request. Please contact support@tradle.io';

  // log('Error:' + err.message);
  res.status(code).json({
    code: code,
    message: msg
  }, null, 2);
}

app.set('joe', joe);
app.set('config', config);

app.use(function(req, res, next) {
  var requestDomain = domain.create();
  requestDomain.add(req);
  requestDomain.add(res);
  requestDomain.on('error', function(err) {
    console.log('Uncaught error, processing in domain error handler', err);
    errorHandler(err, req, res);
  });

  res.on('close', requestDomain.dispose.bind(requestDomain));
  requestDomain.run(next);
});

joe.on('ready', function() {
  log('Send coins to ' + joe.currentReceiveAddress());
  log('Balance: ' + joe.getBalance());

  app.listen(config.address.port);
});

app.use(function(req, res, next) {
  if (req.hostname !== 'localhost' && req.hostname !== '127.0.0.1') throw common.httpError('Only local requests permitted');

  next();
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
 * Hooks
 */
require('./lib/hooks');

/**
 * Error Handling
 */
app.use(errorHandler);

process.on('uncaughtException', function(err) {
  log('Uncaught exception, caught in process catch-all', err.message);
  log(err.stack);
});

module.exports = app;