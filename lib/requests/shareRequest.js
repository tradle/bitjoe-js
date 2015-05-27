var Permission = require('tradle-permission')
var EventEmitter = require('events').EventEmitter
var inherits = require('util').inherits
var utils = require('tradle-utils')
var extend = require('extend')
var typeForce = require('typeforce')
var bitcoin = require('bitcoinjs-lib')
var reqUtils = require('./utils')
var Q = require('q')
var EventEmitter = require('events').EventEmitter
var TxData = require('tradle-tx-data').TxData
var common = require('../common')
var debug = require('debug')('ShareRequest')
var DATA_TYPES = TxData.types

function ShareRequest (options) {
  EventEmitter.call(this)

  typeForce({
    wallet: 'Object',
    keeper: 'Object',
    networkName: 'String',
    minConf: 'Number',
    prefix: 'String'
  }, options)

  extend(this, options)
  this.network = bitcoin.networks[this.networkName]
  utils.bindPrototypeFunctions(this)
}

inherits(ShareRequest, EventEmitter)

ShareRequest.prototype.shareAccessTo = function (fileKey, fileEncryptionKey) {
  this._fileKey = fileKey
  this._encryptionKey = fileEncryptionKey
  return this
}

ShareRequest.prototype.shareAccessWith = function (pubKey) {
  pubKey = common.toPubKey(pubKey)
  this.recipientPubKey = pubKey
  return this
}

/**
 * DEPRECATED, use setPublic
 * @param  {Boolean} cleartext
 * @return {ShareRequest} this share request
 */
ShareRequest.prototype.cleartext = function (cleartext) {
  typeForce('Boolean', cleartext)
  this._cleartext = cleartext
  return this
}

ShareRequest.prototype.setPublic = function (isPublic) {
  typeForce('Boolean', isPublic)
  this._public = isPublic
  return this
}

ShareRequest.prototype.transactionType = function () {
  return this._public ? DATA_TYPES.public : DATA_TYPES.permission
}

ShareRequest.prototype.execute = function () {
  var self = this
  var pubKey = this.recipientPubKey
  var wallet = this.wallet
  var toAddress = pubKey.getAddress(this.network)
  var permissionCost = common.permissionCost(this.networkName)
  var txBuilder = wallet.buildTx()
    .to(toAddress.toString(), permissionCost)
    .minConf(this.minConf)

  if (this.fromAddresses) txBuilder.from(this.fromAddresses)

  var tx
  try {
    tx = txBuilder.build()
  } catch (err) {
    return Q.reject(err)
  }

  if (this._public) {
    var txData = new TxData(this.prefix, this.transactionType(), this._fileKey)
    return this._doSend(tx, txData)
  }

  var permission = new Permission(this._fileKey, this._encryptionKey)
  var input = tx.ins[0]
  var fromAddress = utils.getAddressFromInput(input, this.networkName)
  var privKey = wallet.getPrivateKeyForAddress(fromAddress)
  var encKey = utils.sharedEncryptionKey(privKey, pubKey)
  permission.encrypt(encKey)

  return Q.ninvoke(permission, 'build')
    .then(function () {
      debug('FROM', fromAddress, 'TO', toAddress.toString())
      return reqUtils.store(self.keeper, permission.key(), permission.data())
    })
    .then(function () {
      var keyInTx = self._public ? permission.key() : permission.encryptedKey()
      var txData = new TxData(self.prefix, self.transactionType(), keyInTx)
      return self._doSend(tx, txData, permission)
    })
}

ShareRequest.prototype._doSend = function (tx, data, permission) {
  var dataTx = reqUtils.toDataTx(this.wallet, tx, data)
  return Q.ninvoke(this.wallet, 'sendTx', dataTx)
    .then(function () {
      return {
        tx: dataTx,
        permission: permission
      }
    })
// .catch(function(err) {
//   debug(err)
//   throw err
// })
}

module.exports = ShareRequest
