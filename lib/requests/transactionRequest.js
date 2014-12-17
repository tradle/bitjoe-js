
'use strict';

var async = require('async');
var assert = require('assert');
var EventEmitter = require('events').EventEmitter;
var inherits = require('util').inherits;
var httpError = require('../common').httpError;
// var helloblock = require('helloblock-js');
var bitcoin = require('bitcoinjs-lib');
// var blockchain = require('cb-helloblock');
var ECPubKey = bitcoin.ECPubKey;
var request = require('request');
var common = require('../common');
var cryptoUtils = require('../crypto');
var querystring = require('querystring');
var config = require('../../conf/config.json');
var Permission = require('../permission');
var log = console.log.bind(console);

function TransactionRequest(kit) {
  EventEmitter.call(this);

  this._kit = kit;
}

inherits(TransactionRequest, EventEmitter);

TransactionRequest.prototype.data = function(data) {
  var prefix = common.prefix || '';
  this._data = new Buffer(prefix + JSON.stringify(data));

  // TODO: take into account size of payload
  this._permissionCost = common.permissionCost(this._kit.networkName());

  return this;
}

TransactionRequest.prototype.recipients = function(pubKeys) {
  if (!Array.isArray(pubKeys))
    pubKeys = [pubKeys];

  this._recipients = pubKeys.map(function(pubKey) {
    assert(typeof pubKey === 'string' || pubKey instanceof ECPubKey, 'A recipient can be a public key hex string or an instance of ECPubKey');

    return typeof pubKey === 'string' ? ECPubKey.fromHex(pubKey) : pubKey;
  });

  return this;
}

TransactionRequest.prototype.cleartext = function(cleartext) {
  this._cleartext = cleartext;
  return this;
}

TransactionRequest.prototype.execute = function(callback) {
  var self = this;
  
  callback = common.asyncify(callback);
  if (!this.canAffordStorageTransaction())
    callback(httpError(500, 'Not enough funds to create storage transaction, send coins to ' + this._kit.getNextAddress()));

  this._encrypt();
  this._store(function(err) {
    if (err) return callback(err);

    self._share(callback);
  });
}

TransactionRequest.prototype._encrypt = function() {
  if (!this._cleartext) this._encryptedData = cryptoUtils.encrypt(this._data);
}

TransactionRequest.prototype._store = function(callback) {
  this._value = this._encryptedData || this._data;
  if (!this._key)
    this._key = cryptoUtils.getStorageKeyFor(this._value);

  var keeper = config.keeperAddresses[0];
  var url = keeper.host + ':' + keeper.port + '?' + querystring.stringify({
    key: this._key,
    val: this._value
  });

  return request(url, function(err, resp, body) {
    if (err) return callback(common.httpError(400, 'Failed to reach keeper to store data, aborting transaction'));

    callback(null, resp, body);
  });
}

TransactionRequest.prototype._share = function(callback) {
  var self = this;

  var tasks = this._recipients.map(function(pubKey) {
    return self._shareWith.bind(self, pubKey);
  });

  return async.parallel(tasks, callback);
}

TransactionRequest.prototype._shareWith = function(pubKey, callback) {
  var toAddress = pubKey.getAddress();
  var tx = this._kit.createTx(toAddress, this._permissionCost).transaction;
  var input = tx.getInputs()[0];
  var fromAddress = getAddressFromInput(input);
  var privKey = this._wallet.getPrivateKeyForAddress(fromAddress);
  var permission = new Permission(this._fileHash, this._symmetricKey);
  permission.encrypt(privKey, pubKey);

  var dataScript = bitcoin.scripts.nullDataOutput(permission.key());
  tx.addOutput(dataScript, 0);
  this._kit.sendTx(tx, function(err) {
    if (err) return callback(err);

    callback(null, {
      tx: tx,
      permission: permission
    });
  });
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
  var network = bitcoin.networks[this._kit.networkName()];
  var wallet = this._kit.wallet();
  return wallet.getBalance() >= network.dustThreshold * this._recipients.length;
}

TransactionRequest.prototype._notEnoughFundsErr = function() {
  return httpError(500, 'Not enough funds to create storage transaction, send coins to ' + this._wallet.getNextAddress());
}

function getAddressFromInput(input) {
  // return this._wallet.....script.chunks[1];  script.chunks[1] is canonical public key
  throw new Error('Not implemented');
}

module.exports = TransactionRequest;