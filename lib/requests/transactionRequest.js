
'use strict';

var Q = require('q');
var EventEmitter = require('events').EventEmitter;
var inherits = require('util').inherits;
var httpError = require('../common').httpError;
var helloblock = require('helloblock-js');
var bitcoin = require('bitcoinjs-lib');
var request = Q.denodeify(require('request'));
var common = require('../common');
var querystring = require('querystring');
var config = require('./config.json');
var log = console.log.bind(console);

function TransactionRequest(wallet) {
  EventEmitter.call(this);

  this._wallet = wallet;
  this._network = wallet._network;
}

inherits(TransactionRequest, EventEmitter);

TransactionRequest.prototype.data = function(data) {
  this._data = data;
  return this;
}

TransactionRequest.prototype.recipients = function(pubKeys) {
  this._recipients = pubKeys;
  return this;
}

TransactionRequest.prototype.cleartext = function(cleartext) {
  this._cleartext = cleartext;
  return this;
}

TransactionRequest.prototype.execute = function(callback) {
  callback = common.asyncify(callback);
  if (!this.canAffordStorageTransaction())
    callback(httpError(500, 'Not enough funds to create storage transaction, send coins to ' + this._wallet.getNextAddress()));

  this._encrypt();
  this._store().then(this._share).then(callback);
}

TransactionRequest.prototype._encrypt = function() {
  if (this._cleartext) return;

  // TODO: encrypt
}

TransactionRequest.prototype._store = function(callback) {
  var keeper = config.keeperAddresses[0];
  var url = keeper.host + ':' + keeper.port + '?' + querystring.stringify({
    key: this._key,
    val: this._value
  });

  return request(url);
}

TransactionRequest.prototype._share = function(callback) {
  var tasks = this._recipients.map(this._shareWith);
  return Q.all(tasks, callback);
}

TransactionRequest.prototype._shareWith = function(pubKey) {
  var intermediateFile = new Permission()
}

// /**
//  * NOTE: On testnet - auto-withdraws funds if low
// **/
// TransactionRequest.prototype._checkMinBalance = function() {
//   if (!this.hasMinBalance()) {
//     if (this._network !== 'testnet')
//       throw this._notEnoughFundsErr();

//     log('Not enough funds, withdrawing coins from Testnet Faucet');
//     helloblock.faucet.withdraw(this._receiveFundsAddress, 0.1, callback);
//   }
// }

TransactionRequest.prototype.canAffordStorageTransaction = function() {
  return this._wallet.getBalance() >= this._wallet._network.dustThreshold * this._recipients.length;
}

TransactionRequest.prototype._notEnoughFundsErr = function() {
  return httpError(500, 'Not enough funds to create storage transaction, send coins to ' + this._wallet.getNextAddress());
}