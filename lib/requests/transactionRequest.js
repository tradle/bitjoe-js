'use strict';

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
var utils = require('tradle-utils');
var requireOption = utils.requireOption;
var cryptoUtils = require('../crypto');
var Q = require('q');
var Permission = require('../permission');
var TransactionData = require('../transactionData');
var debug = require('debug')('transaction-request');
var typeForce = require('typeforce');

function TransactionRequest(options) {
  EventEmitter.call(this);

  typeForce('Object', options);
  this._wallet = requireOption(options, 'wallet');
  this._keeper = requireOption(options, 'keeper');
  this._networkName = requireOption(options, 'networkName');
  this._network = bitcoin.networks[this.wallet().networkName];
  this._minConf = options.minConf;
  this._prefix = options.prefix;

  utils.bindPrototypeFunctions(this);

  this._recipients = [];
}

inherits(TransactionRequest, EventEmitter);

TransactionRequest.prototype.data = function(data) {
  this._data = new Buffer(JSON.stringify(data));

  // TODO: take into account size of payload
  this._permissionCost = common.permissionCost(this._networkName);

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
  if (!cleartext && this._public) throw httpError(400, 'Public files are stored in cleartext');

  this._cleartext = cleartext;
  return this;
}

TransactionRequest.prototype.setPublic = function(isPublic) {
  this._public = arguments.length ? isPublic : true;
  if (this._public) this._cleartext = true;

  return this;
}

TransactionRequest.prototype.execute = function() {
  var self = this;

  if (!this.canAffordStorageTransaction()) {
    var err = utils.httpError(500, 'Not enough funds to create storage transaction, send coins to ' + this.wallet().getNextAddress());
    return Q.reject(err);
  }

  if (!this._cleartext) this._encrypt();

  this._value = this._encryptedData || this._data;
  return cryptoUtils.getStorageKeyFor(this._value)
    .then(function(key) {
      self._key = key;
      return self._store(key, self._value);
    })
    .then(this._share)
    .then(function(resp) {
      // maybe just emit resp

      self.emit('file:shared', {
        key: self._key,
        value: self._value,
        recipients: self._recipients
      });

      return resp;
    });
}

TransactionRequest.prototype._encrypt = function() {
  this._symmetricKey = crypto.randomBytes(32);
  this._encryptedData = cryptoUtils.encrypt(this._data, this._symmetricKey);
}

TransactionRequest.prototype._store = function(key, value) {
  var self = this;
  key = cryptoUtils.toHumanReadableString(key);

  return this._keeper.put(key, value)
    .catch(function(err) {
      debug('Failed to get data from keeper: ' + err);
      throw utils.httpError(err.code || 400, err.message || 'Failed to store data on keeper');
    })
}

TransactionRequest.prototype._share = function() {
  var self = this;
  var wallet = this.wallet();
  if (!this._recipients || !this._recipients.length) {
    // share with self
    var addr = wallet.getNextAddress();
    var pubKey = wallet.getPublicKeyForAddress(addr);
    this._recipients = [pubKey];
  }

  var tasks = this._recipients.map(this._shareWith);

  return Q.all(tasks)
    .then(function(results) {
      var fileKey = cryptoUtils.toHumanReadableString(self._key);
      var resp = {
        fileKey: fileKey,
        permissions: {},
        public: {}
      };

      if (self._keeper.urlFor) resp.fileUrl = self._keeper.urlFor(fileKey);

      results.forEach(function(info, idx) {
        var pubKey = self._recipients[idx].toHex();
        var shareInfo = {
          txId: info.tx.getId(),
          txUrl: common.getTransactionUrl(self._networkName, info.tx.getId())
        };

        if (info.permission) {
          shareInfo.key = cryptoUtils.toHumanReadableString(info.permission.key());
          if (self._keeper.urlFor) shareInfo.fileUrl = self._keeper.urlFor(shareInfo.key);

          resp.permissions[pubKey] = shareInfo;
        } else if (self._public) {
          resp['public'][pubKey] = shareInfo;
        }
      });

      debug(resp);
      return resp;
    });
}

TransactionRequest.prototype.transactionType = function() {
  var types = TransactionData.types;
  return this._public ? types.PUBLIC :
    this._cleartext ? types.CLEARTEXT_STORE : types.ENCRYPTED_SHARE;
}

TransactionRequest.prototype._shareWith = function(pubKey) {
  var self = this;

  var wallet = this.wallet();
  var network = this._network;
  var toAddress = pubKey.getAddress(network);
  var minConf = this._minConf;
  var tx = wallet.createTx(toAddress.toString(), this._permissionCost, null, minConf);
  if (this._public) {
    var txData = new TransactionData(this._prefix, this.transactionType(), this._key);
    return this._doSend(tx, txData);
  }

  var input = tx.ins[0];
  var fromAddress = wallet.getAddressFromInput(input);
  var privKey = wallet.getPrivateKeyForAddress(fromAddress);
  var encKey;
  var permission = new Permission(this._key, this._symmetricKey);
  encKey = cryptoUtils.sharedEncryptionKey(privKey, pubKey);
  if (this._cleartext)
    permission.encryptKey(encKey);
  else
    permission.encrypt(encKey);

  return permission.build()
    .then(function() {
      debug('FROM', fromAddress, 'TO', toAddress.toString());

      var pKey = cryptoUtils.toHumanReadableString(permission.key());
      var pVal = permission.data();
      return self._store(pKey, pVal);
    })
    .then(function() {
      var keyInTx = self._public ? permission.key() : permission.encryptedKey();
      var txData = new TransactionData(self._prefix, self.transactionType(), keyInTx);
      return self._doSend(tx, txData, permission);
    })
}

TransactionRequest.prototype._doSend = function(tx, data, permission) {
  var wallet = this.wallet();
  var dataTx = this.toDataTransaction(tx, data);
  return Q.ninvoke(wallet, 'sendTx', dataTx)
    .then(function() {
      return {
        tx: dataTx,
        permission: permission
      }
    })
    .catch(function(err) {
      debug(err);
      throw err;
    });
}

TransactionRequest.prototype.wallet = function() {
  return this._wallet;
}

TransactionRequest.prototype.canAffordStorageTransaction = function() {
  var wallet = this.wallet();
  var network = bitcoin.networks[wallet.networkName];
  var tmpTx;
  try {
    tmpTx = wallet.createTx(wallet.getNextAddress(), this._permissionCost, null, this._minConf);
  } catch (err) {
    return false;
  }

  var fee = network.estimateFee(tmpTx);
  return wallet.getBalance() >= (fee + this._permissionCost) * (this._recipients.length || 1);
}

TransactionRequest.prototype._notEnoughFundsErr = function() {
  return httpError(500, 'Not enough funds to create storage transaction, send coins to ' + this.wallet().getNextAddress());
}

TransactionRequest.prototype.toDataTransaction = function(tx, txData) {
  // unfortunately createTx is not idempotent - it adds a new change address
  // var dataTx = wallet.createTx(toAddress.toString(), self._permissionCost, null, minConf, txData.serialize());

  var wallet = this.wallet();
  var dataTxb = new bitcoin.TransactionBuilder();
  var addresses = [];
  tx.ins.forEach(function(txIn) {
    dataTxb.addInput(txIn.hash, txIn.index, txIn.sequence);
    addresses.push(wallet.getAddressFromInput(txIn));
  })

  // Extract/add outputs
  tx.outs.forEach(function(txOut) {
    dataTxb.addOutput(txOut.script, txOut.value);
  })

  dataTxb.addOutput(bitcoin.scripts.nullDataOutput(txData.serialize()), 0);
  addresses.forEach(function(address, i) {
    dataTxb.sign(i, wallet.getPrivateKeyForAddress(address));
  })

  return dataTxb.build();
}

module.exports = TransactionRequest;
