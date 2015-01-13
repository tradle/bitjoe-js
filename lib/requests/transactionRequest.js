
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
var cryptoUtils = require('../crypto');
var Q = require('q');
var Permission = require('../permission');
var TransactionData = require('../transactionData');
var debug = require('debug')('transaction-request');

function TransactionRequest(joe) {
  EventEmitter.call(this);

  common.bindPrototypeFunctions(this);

  this._joe = joe;
  this._recipients = [];
}

inherits(TransactionRequest, EventEmitter);

TransactionRequest.prototype.data = function(data) {
  this._data = new Buffer(JSON.stringify(data));

  // TODO: take into account size of payload
  this._permissionCost = common.permissionCost(this._joe.networkName());
  this._keeper = this._joe.keeper();

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
  this._public = isPublic;
  if (isPublic) this._cleartext = true;

  return this;
}

TransactionRequest.prototype.execute = function() {
  var self = this;

  if (!this.canAffordStorageTransaction()) {
    var err = httpError(500, 'Not enough funds to create storage transaction, send coins to ' + this._joe.getNextAddress());
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

  return Q.Promise(function(resolve, reject) {
    self._keeper.put(key, value, function(err, resp, body) {
      if (err) return reject(err);

      if (resp.statusCode > 399) {
        try {
          err = JSON.parse(body);
        } catch (err) {
          debug('Failed to parse response from keeper: ' + body);
        }

        return reject(common.httpError(err.code || 400, err.message || 'Failed to store data on keeper'));
      }

      resolve();
    });
  });
}

TransactionRequest.prototype._share = function() {
  var self = this;
  if (!this._recipients || !this._recipients.length) {
    var addr = this._joe.wallet().getNextAddress();
    var pubKey = this._joe.getPublicKeyForAddress(addr);
    this._recipients = [pubKey];
  }

  var tasks = this._recipients.map(this._shareWith);

  return Q.all(tasks)
  .then(function(results) {
    var fileKey = cryptoUtils.toHumanReadableString(self._key);
    var resp = {
      fileKey: fileKey,
      fileUrl: self._keeper.urlFor(fileKey),
      permissions: {},
      'public': {}
    };

    results.forEach(function(info, idx) {
      var pubKey = self._recipients[idx].toHex();
      var shareInfo = {
        txId: info.tx.getId(),
        txUrl: common.getTransactionUrl(self._joe.networkName(), info.tx.getId())
      };

      if (info.permission) {
        shareInfo.key = cryptoUtils.toHumanReadableString(info.permission.key());
        shareInfo.fileUrl = self._keeper.urlFor(shareInfo.key);
        resp.permissions[pubKey] = shareInfo;
      }
      else if (self._public) {
        resp['public'][pubKey] = shareInfo;
      }
    });

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

  var joe = this._joe;
  var wallet = this.wallet();
  var network = bitcoin.networks[wallet.networkName];
  var toAddress = pubKey.getAddress(network);
  var minConf = joe.config('minConf');
  var tx = wallet.createTx(toAddress.toString(), this._permissionCost, null, minConf);
  if (this._public) {
    var txData = new TransactionData(joe.config('prefix'), this.transactionType(), this._key);
    return this._doSend(tx, txData);
  }

  var input = tx.ins[0];
  var fromAddress = common.getAddressFromInput(input, network);
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
      var txData = new TransactionData(joe.config('prefix'), self.transactionType(), keyInTx);
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
  return this._joe.wallet();
}

TransactionRequest.prototype.canAffordStorageTransaction = function() {
  var wallet = this.wallet();
  var network = bitcoin.networks[wallet.networkName];
  var tmpTx;
  try {
    tmpTx = wallet.createTx(this._joe.getNextAddress(), this._permissionCost, null, this._joe.config('minConf'));
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

  return dataTxb.build();
}

module.exports = TransactionRequest;