
'use strict';

var express = require('express');
var common = require('../common');
var domain = require('domain');
var debug = require('debug')('bitjoe-server');

function createServer(joe, port, callback) {
  var app = express();

  app.set('joe', joe);
  app.set('config', joe.config());
  if (joe.isTestnet())
    app.set('json spaces', 2);

  app.use(function(req, res, next) {
    var requestDomain = domain.create();
    requestDomain.add(req);
    requestDomain.add(res);
    requestDomain.on('error', function(err) {
      debug('Uncaught error, processing in domain error handler', err);
      errorHandler(err, req, res);
    });

    res.on('close', requestDomain.dispose.bind(requestDomain));
    requestDomain.run(next);
  });

  // if (require.main === module) {
  //   // run directly, not as sub-app
  var server = app.listen(port, function() {
    debug('Running on port ' + port);
    callback(null, server);
  });

  // }
  // else
  //   callback();

  app.use(function(req, res, next) {
    if (req.hostname !== 'localhost' && req.hostname !== '127.0.0.1') throw common.httpError('Only local requests permitted');

    next();
  });

  app.use(function onready(req, res, next) {
    if (!joe.isReady()) 
      return joe.on('ready', next);
    else 
      next();
  })

  /**
   * Routes
   */
  require('./router')(app);

  /**
   * Hooks
   */
  require('./hooks');

  /**
   * Error Handling
   */
  app.use(errorHandler);

  function errorHandler(err, req, res, next) {
    debugger;
    if (res.finished) return;

    var code = err.status || 500;
    var msg = 'status' in err ? err.message : 'There was an error with your request. Please contact support@tradle.io';

    // log('Error:' + err.message);
    res.status(code).json({
      code: code,
      message: msg
    }, null, 2);
  }
}

process.on('uncaughtException', function(err) {
  debug('Uncaught exception, caught in process catch-all', err.message);
  debug(err.stack);
});

module.exports = {
  create: createServer
};