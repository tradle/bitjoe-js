
'use strict';

var express = require('express');
var prompt = require('prompt');
var path = require('path');
var commonBlockchains = require('./lib/commonBlockchains');
var EventEmitter = require('events').EventEmitter;
var inherits = require('util').inherits;
var WalletAppKit = require('./lib/walletAppKit');
var DEFAULT_CONFIG = require('./conf/config.json');
var log = console.log.bind(console);
var defaults = require('defaults');
var _ = require('lodash');
var common = require('./lib/common');
var requests = require('./lib/requests');
var MIN_BALANCE = 1e7;
// var reemit = require('re-emitter');
var TransactionRequest = requests.TransactionRequest;
var noop = function() {};
// var deasync = require('deasync');
// var asyncWithdraw = deasync(blockchain.faucet.bind(blockchain.faucet));

module.exports = BitJoe;

function BitJoe(config) {
  var self = this;
  var prototypeFns = _.functions(this.prototype);
  prototypeFns.unshift(this);
  _.bindAll.apply(_, prototypeFns);

  EventEmitter.call(this);

  this._config = defaults(config || {}, DEFAULT_CONFIG);
  this.on('error', this._onerror.bind(this));

  this._startServer();
  this._promptPassword(function() {  
    self._loadWallet(self._onInitialized.bind(self));
  });
}

inherits(BitJoe, EventEmitter);

BitJoe.prototype._onerror = function(err) {
  log(err);
}

BitJoe.prototype._loadWallet = function(callback) {
  var self = this;

  var storageConfig = this._config.wallet;
  var walletConfig = _.pick(this.config(), 'allowSpendUnconfirmed', 'networkName');

  walletConfig.password = this.config('wallet').password;
  walletConfig.path = path.join(storageConfig.folder, storageConfig.name + '.wallet');
  walletConfig.autosave = true;

  this._kit = new WalletAppKit(walletConfig);
  this._kit.startAsync();
  this._kit.on('ready', function() {
    if (self.isTestnet() && self._kit.getBalance() < MIN_BALANCE) {
      commonBlockchains('testnet').addresses.__faucetWithdraw(self.currentReceiveAddress(), MIN_BALANCE, function(err, res) {
        debugger;
        callback();
      });
    }
    else
      callback();
  });
}

BitJoe.prototype.refundToFaucet = function(callback) {
  if (!this.isTestnet()) return callback(new Error('Can only return testnet coins'));

  this._kit.sendCoins({
    toAddress: 'msj42CCGruhRsFrGATiUuh25dtxYtnpbTx', // TP's testnet faucet, Mojocoin faucet: mkTXKrJn5nAbuUuvGLt6GQGAkbmnWnjoQt
    value: this._kit.getBalance(),
    minConf: 0
  }, callback || noop);
}

BitJoe.prototype._onInitialized = function(err) {
  if (err) {
    log(err);
    return process.exit();
  }

  this.emit('ready');
}

BitJoe.prototype._startServer = function(callback) {
  this._app = express();
  this._initRouter();
  this._server = this._app.listen(this._config.address.port, callback);
}

BitJoe.prototype._promptPassword = function(callback) {
  var self = this;

  callback = common.asyncify(callback);
  if (this.config('wallet').password)
    return callback();

  prompt.start();
  prompt.get([{
    name: 'password',
    description: 'Please enter the password for your wallet',
    required: true,
    hidden: true
  }], function (err, result) {
    self.config('wallet').password = result.password;
    callback();
  });
}

BitJoe.prototype._initRouter = function() {
  this._app.route('/hooks').post(this._onwebhookrequest);
  this._app.route('/transaction').post(this._ontransactionrequest);
  if (this.isTestnet())
    this._app.route('/refund').get(this._onrefundrequest);

  this._app.route('/bootstrap').post(this._onbootstraprequest);

  this._app.use(function(err, req, res, next) {
    if (err.status <= 399) return next(); // all good
   
    res.json(err);
  });
}

BitJoe.prototype._onwebhookrequest = function(req, res) {
  res.status(501).send('Not supported');
}

BitJoe.prototype._ontransactionrequest = function(req, res) {
  debugger;

  var to = requireParam(req, 'to').split(',');
  var data = requireParam(req, 'data');
  var cleartext = common.isTruthy(req.params.cleartext);
  var tReq = new TransactionRequest(this._kit)
                      .data(data)
                      .recipients(to)
                      .cleartext(cleartext);

  tReq.execute(function(err, resp) {
    if (err) return defaultErrorHandler(res, err);

    res.status(200).json(resp);
  });
}

BitJoe.prototype._onrefundrequest = function(req, res) {
  debugger;

  this.refundToFaucet(function(err) {
    var status = err ? 400 : 200;
    var message = err ? err.message : 'OK';

    res.status(status).json({
      code: status,
      message: message
    });
  });
}

BitJoe.prototype._onbootstraprequest = function(req, res) {
  res.status(501).send('Not supported');
}

BitJoe.prototype.currentReceiveAddress = function() {
  return this._kit.getReceiveAddress();
}

BitJoe.prototype.wallet = function() {
  return this._kit.wallet();
}

BitJoe.prototype.kit = function() {
  return this._kit;
}

BitJoe.prototype.config = function(configOption) {
  return typeof configOption === 'undefined' ? 
      this._config : 
      this._config[configOption];
}

BitJoe.prototype.setConfig = function(option, value) {
  if (arguments.length === 1)
    this._config = option;
  else
    this._config[option] = value;
}

BitJoe.prototype.isTestnet = function() {
  return this.config('networkName') === 'testnet';
}

function requireParam(req, param) {
  if (!(param in req.params)) throw new Error('Missing required parameter: ' + param);

  return req.params[param];
}

function defaultErrorHandler(res, err) {
  var code = err.code || 400;
  res.status(code).send(err.message);
} 