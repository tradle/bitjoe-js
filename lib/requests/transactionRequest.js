
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
var crypto = require('crypto');
var common = require('../common');
var cryptoUtils = require('../crypto');
var Permission = require('../permission');
var KeeperAPI = require('../keeperAPI');
var TransactionData = require('../transactionData');
var log = console.log.bind(console);

function TransactionRequest(joe) {
  EventEmitter.call(this);

  this._joe = joe;
  this._config = joe.config();
}

inherits(TransactionRequest, EventEmitter);

TransactionRequest.prototype.data = function(data) {
  this._data = new Buffer(JSON.stringify(data));

  // TODO: take into account size of payload
  this._permissionCost = common.permissionCost(this._joe.networkName());
  this._keeper = new KeeperAPI(this._config.keeperAddresses[0]);

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
    callback(httpError(500, 'Not enough funds to create storage transaction, send coins to ' + this._joe.getNextAddress()));

  this._encrypt();

  this._value = this._encryptedData || this._data;
  if (!this._key)
    this._key = cryptoUtils.getStorageKeyFor(this._value);

  var key = cryptoUtils.toHumanReadableString(this._key);
  var value = cryptoUtils.fileToString(this._value);

  this._store(key, value, function(err) {
    if (err) return callback(err);

    self._share(callback);
  });
}

TransactionRequest.prototype._encrypt = function() {
  if (!this._cleartext) {
    this._symmetricKey = crypto.randomBytes(32);
    this._encryptedData = cryptoUtils.encrypt(this._data, this._symmetricKey);
  }
}

TransactionRequest.prototype._store = function(key, value, callback) {
  this._keeper.put(key, value, callback);
}

TransactionRequest.prototype._share = function(callback) {
  var self = this;

  var tasks = this._recipients.map(function(pubKey) {
    return self._shareWith.bind(self, pubKey);
  });

  return async.parallel(tasks, function(err, results) {
    if (err) return callback(err);

    var resp = {
      fileKey: cryptoUtils.toHumanReadableString(self._key),
      permissions: {}
    };

    results.forEach(function(info, idx) {
      var pubKey = self._recipients[idx].toHex();
      resp.permissions[pubKey] = {
        key: cryptoUtils.toHumanReadableString(info.permission.key()),
        txId: info.tx.getId()
      }
    });

    callback(null, resp);
  });
}

TransactionRequest.prototype._shareWith = function(pubKey, callback) {
  var self = this;

  var joe = this._joe;
  var wallet = this.wallet();
  var network = bitcoin.networks[wallet.networkName];
  var toAddress = pubKey.getAddress(network);
  var minConf = joe.config('minConf');
  var tx = wallet.createTx(toAddress.toString(), this._permissionCost, null, minConf);
  var input = tx.ins[0];
  var fromAddress = common.getAddressFromInput(input, network);
  var privKey = wallet.getPrivateKeyForAddress(fromAddress);
  var permission = new Permission(this._key, this._symmetricKey);
  permission.encrypt(privKey, pubKey);
  log('FROM', fromAddress, 'TO', toAddress.toString());

  this._store(
    cryptoUtils.toHumanReadableString(permission.key()), 
    cryptoUtils.fileToString(permission.data()),
    onPut
  );

  function onPut(err) {
    if (err) return callback(err);

    var txData = new TransactionData(self._config.prefix, TransactionData.types.ENCRYPTED_SHARE, permission.encryptedKey());

    // unfortunately createTx is not idempotent - it adds a new change address
    // var dataTx = wallet.createTx(toAddress.toString(), self._permissionCost, null, minConf, txData.serialize());

    var dataTx = self.toDataTransaction(tx, txData);
    wallet.sendTx(dataTx, function(err) {
      if (err) return callback(err);

      callback(null, {
        tx: dataTx,
        permission: permission
      });
    });
  }
}

TransactionRequest.prototype.wallet = function() {
  return this._joe.wallet();
}

TransactionRequest.prototype.canAffordStorageTransaction = function() {
  var wallet = this.wallet();
  var network = bitcoin.networks[wallet.networkName];
  return wallet.getBalance() >= network.dustThreshold * this._recipients.length;
}

TransactionRequest.prototype._notEnoughFundsErr = function() {
  return httpError(500, 'Not enough funds to create storage transaction, send coins to ' + this.wallet().getNextAddress());
}

TransactionRequest.prototype.toDataTransaction = function(tx, txData) {
  var joe = this._joe;
  var dataTxb = new bitcoin.TransactionBuilder();
  var addresses = [];
  tx.ins.forEach(function(txIn) {
    dataTxb.addInput(txIn.hash, txIn.index, txIn.sequence);
    addresses.push(joe.getAddressFromInput(txIn));
  })

  // Extract/add outputs
  tx.outs.forEach(function(txOut) {
    dataTxb.addOutput(txOut.script, txOut.value);
  })

  dataTxb.addOutput(bitcoin.scripts.nullDataOutput(txData.serialize()), 0);
  addresses.forEach(function(address, i) {
    dataTxb.sign(i, joe.getPrivateKeyForAddress(address));
  })

  var dataTx = dataTxb.build();

  var addrs = tx.outs.slice(0, 2).map(joe.getAddressFromOutput);
  var addrs1 = dataTx.outs.map(joe.getAddressFromOutput);

  assert(addrs.filter(function(a) { return addrs1.indexOf(a) === -1 }).length === 0);

  return dataTx;
}

module.exports = TransactionRequest;