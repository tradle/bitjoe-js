'use strict';

var assert = require('assert');
var EventEmitter = require('events').EventEmitter;
var inherits = require('util').inherits;
var httpError = require('../common').httpError;
// var helloblock = require('helloblock-js');
var bitcoin = require('bitcoinjs-lib');
// var blockchain = require('cb-helloblock');
var crypto = require('crypto');
var common = require('../common');
var utils = require('tradle-utils');
var requireOption = utils.requireOption;
var cryptoUtils = require('../crypto');
var Q = require('q');
var Permission = require('../permission');
var TransactionData = require('../transactionData');
var ShareRequest = require('./shareRequest');
var debug = require('debug')('transaction-request');
var typeForce = require('typeforce');
var defaults = require('defaults');
var uniq = require('uniq');
var reqUtils = require('./utils');

function TransactionRequest(options) {
  EventEmitter.call(this);

  typeForce({
    joe: 'Object',
    wallet: 'Object',
    keeper: 'Object',
    networkName: 'String',
    minConf: 'Number',
    prefix: 'String'
  }, options);

  this._options = options;
  defaults(this, options);
  utils.bindPrototypeFunctions(this);

  this.network = bitcoin.networks[this.networkName];
  this._recipients = [];
}

inherits(TransactionRequest, EventEmitter);

TransactionRequest.prototype.data = function(data) {
  assert(data, 'Missing required parameter: data');

  this._data = data;
  if (typeof data === 'string') {
    this._dataBuf = new Buffer(data);
  }
  else if (Buffer.isBuffer(data)) {
    this._dataBuf = data;
  }
  else if (typeof data === 'object') {
    this._dataBuf = new Buffer(JSON.stringify(data));
  }
  else {
    throw new TypeError('Parameter "data" can be one of the following types: String, Buffer, POJO');
  }

  // TODO: take into account size of payload
  this._permissionCost = common.permissionCost(this.networkName);

  return this;
}

TransactionRequest.prototype.shareWith =
TransactionRequest.prototype.recipients = function(pubKeys) {
  if (!Array.isArray(pubKeys)) pubKeys = [pubKeys];

  this._recipients = uniq(pubKeys).map(common.toPubKey);
  return this;
}

TransactionRequest.prototype.cleartext = function(cleartext) {
  typeForce('Boolean', cleartext);
  if (!cleartext && this._public) throw httpError(400, 'Public files are stored in cleartext');

  this._cleartext = cleartext;
  return this;
}

TransactionRequest.prototype.setPublic = function(isPublic) {
  typeForce('Boolean', isPublic);
  this._public = isPublic;
  if (this._public) this._cleartext = true;

  return this;
}

TransactionRequest.prototype.execute = function() {
  var self = this;

  if (!this.canAffordStorageTransaction()) {
    var err = utils.httpError(500, 'Not enough funds to create storage transaction, send coins to ' + this.wallet.getNextAddress());
    return Q.reject(err);
  }

  return this.joe.processOutgoingFile(this._data)
    .then(function(data) {
      self.data(data); // update data
      if (!self._cleartext) self._encrypt();

      self._value = self._encryptedData || self._dataBuf;
      return cryptoUtils.getStorageKeyFor(self._value);
    })
    .then(function(key) {
      self._key = key;
      return reqUtils.store(self.keeper, key, self._value);
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
  this._encryptedData = cryptoUtils.encrypt(this._dataBuf, this._symmetricKey);
}

TransactionRequest.prototype._share = function() {
  var self = this;
  var wallet = this.wallet;
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

      if (self.keeper.urlFor) resp.fileUrl = self.keeper.urlFor(fileKey);

      results.forEach(function(info, idx) {
        var pubKey = self._recipients[idx].toHex();
        var shareInfo = {
          txId: info.tx.getId(),
          txUrl: common.getTransactionUrl(self.networkName, info.tx.getId())
        };

        if (info.permission) {
          shareInfo.key = cryptoUtils.toHumanReadableString(info.permission.key());
          if (self.keeper.urlFor) shareInfo.fileUrl = self.keeper.urlFor(shareInfo.key);

          resp.permissions[pubKey] = shareInfo;
        } else if (self._public) {
          resp['public'][pubKey] = shareInfo;
        }
      });

      debug(resp);
      return resp;
    });
}

TransactionRequest.prototype._shareWith = function(pubKey) {
  return new ShareRequest(this._options)
    .shareAccessTo(this._key, this._symmetricKey)
    .shareAccessWith(pubKey)
    .setPublic(this._public || false)
    .cleartext(this._cleartext || false)
    .execute();
}

TransactionRequest.prototype.canAffordStorageTransaction = function() {
  var wallet = this.wallet;
  var network = bitcoin.networks[wallet.networkName];
  var tmpTx;
  try {
    tmpTx = wallet.createTx(wallet.getNextAddress(), this._permissionCost, null, this.minConf);
  } catch (err) {
    return false;
  }

  var fee = network.estimateFee(tmpTx);
  return wallet.getBalance() >= (fee + this._permissionCost) * (this._recipients.length || 1);
}

TransactionRequest.prototype._notEnoughFundsErr = function() {
  return httpError(500, 'Not enough funds to create storage transaction, send coins to ' + this.wallet.getNextAddress());
}

module.exports = TransactionRequest;
