
'use strict';

var express = require('express');
var _ = require('lodash');
var helloblock = require('helloblock-js');
var bitcoin = require('bitcoinjs-lib');
var Wallet = require('./wallet');
var config = require('./config.json');
var log = console.log.bind(console);
// var deasync = require('deasync');
// var asyncWithdraw = deasync(helloblock.faucet.bind(helloblock.faucet));

function BitJoe(callback) {
  var walletOptions = _.pick(config, 'allowSpendUnconfirmed', 'network');
  this._wallet = new Wallet(walletOptions);
  this._networkName = config.network;
  this._network = bitcoin.networks[walletOptions.network];

  var myAddress = config.joeAddress;
  this._receiveFundsAddress = this._wallet.getNextAddress();
  this._app = express();
  this._server = this._app.listen(myAddress.port || 8080, callback);
  this._initRouter();
}

BitJoe.prototype._initRouter = function() {
  this._app.route('/hooks').post(this._webhookrequest);
  this._app.route('/transaction').post(this._transactionrequest);
  this._app.route('/bootstrap').post(this._bootstraprequest);

  this._app.use(function(err, req, res, next) {
    if (err.status <= 399) return next(); // all good
   
    res.json(err);
  });
}

BitJoe.prototype._webhookrequest = function(req, res) {
  res.status(501).send('Not supported');
}

BitJoe.prototype._transactionrequest = function(req, res) {
  var self = this;

  var to = requireParam(req, 'to').split(',');
  var data = requireParam(req, 'data');
  var cleartext = isTruthy(req.params.cleartext);
  var tReq = new TransactionRequest(this._wallet)
                      .data(data)
                      .recipients(to)
                      .cleartext(cleartext);

  tReq.execute(function(err, resp) {
    if (err) return defaultErrorHandler(res, err);

    res.status(200).json(resp);
  });
}

BitJoe.prototype._bootstraprequest = function(req, res) {
  res.status(501).send('Not supported');
}

function requireParam(req, param) {
  if (!(param in req.params)) throw new Error('Missing required parameter: ' + param);

  return req.params[param];
}

function isTruthy(val) {
  if (val instanceof Number) return !!val;
  
  return val !== '0' && val !== 'false';
}

function defaultErrorHandler(res, err) {
  var code = err.code || 400;
  res.status(code).send(err.message);
} 