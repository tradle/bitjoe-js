
var Permission = require('../permission');
var EventEmitter = require('events').EventEmitter;
var inherits = require('util').inherits;
var utils = require('tradle-utils');
var cryptoUtils = require('../crypto');
var requireOption = utils.requireOption;
var defaults = require('defaults');
var typeForce = require('typeforce');
var bitcoin = require('bitcoinjs-lib');
var reqUtils = require('./utils');
var Q = require('q');
var EventEmitter = require('events').EventEmitter;
var TransactionData = require('../transactionData');
var common = require('../common');
var debug = require('debug')('ShareRequest');

function ShareRequest(options) {
  EventEmitter.call(this);

  typeForce({
    wallet: 'Object',
    keeper: 'Object',
    networkName: 'String',
    minConf: 'Number',
    prefix: 'String'
  }, options);

  defaults(this, options);
  this.network = bitcoin.networks[this.networkName];
  utils.bindPrototypeFunctions(this);
}

inherits(ShareRequest, EventEmitter);

ShareRequest.prototype.shareAccessTo = function(fileKey, fileEncryptionKey) {
  this._fileKey = fileKey;
  this._encryptionKey = fileEncryptionKey;
  return this;
}

ShareRequest.prototype.shareAccessWith = function(pubKey) {
  pubKey = common.toPubKey(pubKey);
  this.recipientPubKey = pubKey;
  return this;
}

ShareRequest.prototype.cleartext = function(cleartext) {
  typeForce('Boolean', cleartext);
  this._cleartext = cleartext;
  return this;
}

ShareRequest.prototype.setPublic = function(isPublic) {
  typeForce('Boolean', isPublic);
  this._public = isPublic;
  return this;
}

ShareRequest.prototype.transactionType = function() {
  var types = TransactionData.types;
  return this._public ? types.PUBLIC :
    this._cleartext ? types.CLEARTEXT_STORE : types.ENCRYPTED_SHARE;
}

ShareRequest.prototype.execute = function() {
  var self = this;
  var pubKey = this.recipientPubKey;
  var wallet = this.wallet;
  var toAddress = pubKey.getAddress(this.network);
  var permissionCost = common.permissionCost(this.networkName);
  var tx = wallet.createTx(toAddress.toString(), permissionCost, null, this.minConf);
  if (this._public) {
    var txData = new TransactionData(this.prefix, this.transactionType(), this._fileKey);
    return this._doSend(tx, txData);
  }

  var permission = new Permission(this._fileKey, this._encryptionKey);
  var input = tx.ins[0];
  var fromAddress = wallet.getAddressFromInput(input);
  var privKey = wallet.getPrivateKeyForAddress(fromAddress);
  var encKey = cryptoUtils.sharedEncryptionKey(privKey, pubKey);
  if (this._cleartext)
    permission.encryptKey(encKey);
  else
    permission.encrypt(encKey);

  return permission.build()
    .then(function() {
      debug('FROM', fromAddress, 'TO', toAddress.toString());

      var pKey = cryptoUtils.toHumanReadableString(permission.key());
      var pVal = permission.data();
      return reqUtils.store(self.keeper, pKey, pVal);
    })
    .then(function() {
      var keyInTx = self._public ? permission.key() : permission.encryptedKey();
      var txData = new TransactionData(self.prefix, self.transactionType(), keyInTx);
      return self._doSend(tx, txData, permission);
    })
}

ShareRequest.prototype._doSend = function(tx, data, permission) {
  var dataTx = reqUtils.toDataTx(this.wallet, tx, data);
  return Q.ninvoke(this.wallet, 'sendTx', dataTx)
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

module.exports = ShareRequest;
