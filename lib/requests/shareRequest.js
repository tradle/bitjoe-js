var Permission = require('tradle-permission')
var EventEmitter = require('events').EventEmitter
var inherits = require('util').inherits
var utils = require('tradle-utils')
var extend = require('extend')
var typeForce = require('typeforce')
var bitcoin = require('bitcoinjs-lib')
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
  var toAddress = pubKey.getAddress(this.network).toString()

  var builder = this.wallet
    .send()
    .to(toAddress, common.permissionCost(this.networkName))

  if (this._public) {
    var txData = new TxData(this.prefix, this.transactionType(), this._fileKey)
    return this._doSend(builder, txData)
  }

  var permission = new Permission(this._fileKey, this._encryptionKey)
  var encKey = utils.sharedEncryptionKey(wallet.priv, pubKey)
  permission.encrypt(encKey)

  return Q.ninvoke(permission, 'build')
    .then(function () {
      debug('FROM', wallet.addressString, 'TO', toAddress)
      return self.keeper.put(permission.key().toString('hex'), permission.data())
    })
    .then(function () {
      var keyInTx = self._public ? permission.key() : permission.encryptedKey()
      var txData = new TxData(self.prefix, self.transactionType(), keyInTx)
      return self._doSend(builder, txData, permission)
    })
}

ShareRequest.prototype._doSend = function (builder, txData, permission) {
  builder.data(txData.data())
  return Q.ninvoke(builder, 'execute')
    .then(function () {
      return {
        tx: builder.tx,
        permission: permission
      }
    })
// .catch(function(err) {
//   debug(err)
//   throw err
// })
}

module.exports = ShareRequest
