var inherits = require('util').inherits
var EventEmitter = require('events').EventEmitter
var debug = require('debug')('ShareRequest')
var utils = require('tradle-utils')
var extend = require('extend')
var once = require('once')
var Permission = require('tradle-permission')
var EventEmitter = require('events').EventEmitter
var typeForce = require('typeforce')
var bitcoin = require('bitcoinjs-lib')
var Q = require('q')
var TxData = require('tradle-tx-data').TxData
var common = require('../common')
var DATA_TYPES = TxData.types
var DEFAULT_FEE = 20000

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

ShareRequest.prototype.fee = function (fee) {
  this._fee = fee
}

ShareRequest.prototype.build = function () {
  var self = this
  var pubKey = this.recipientPubKey
  var toAddress = pubKey.getAddress(this.network).toString()
  var buildReq
  if (this._public) {
    buildReq = Q({
      txData: new TxData(this.prefix, this.transactionType(), this._fileKey)
    })
  } else {
    debug('FROM', this.wallet.addressString, 'TO', toAddress)
    buildReq = this._buildPermissionReq()
  }

  return buildReq.then(function (req) {
    var builder = self.wallet
      .send()
      .fee(self._fee || DEFAULT_FEE)
      .to(toAddress, common.permissionCost(self.networkName))
      .data(req.txData.serialize())

    return Q.ninvoke(builder, 'build')
      .then(function (tx) {
        // builder may return unspents used as second arg
        if (Array.isArray(tx)) tx = tx[0]

        req.pubKey = self.recipientPubKey.toHex()
        req.tx = tx
        req.txId = tx.getId()
        req.execute = once(self.execute.bind(self, req))
        return req
      })
  })
}

ShareRequest.prototype._buildPermissionReq = function () {
  var self = this
  var permission = new Permission(this._fileKey, this._encryptionKey)
  var encKey = utils.sharedEncryptionKey(this.wallet.priv, this.recipientPubKey)
  permission.encrypt(encKey)
  return Q.ninvoke(permission, 'build')
    .then(function () {
      var keyInTx = self._public ? permission.key() : permission.encryptedKey()
      return {
        key: permission.key().toString('hex'),
        value: permission.data(),
        permission: permission,
        txData: new TxData(self.prefix, self.transactionType(), keyInTx)
      }
    })
}

ShareRequest.prototype.execute = function (req) {
  var wallet = this.wallet
  if (!req) return this.build().then(this.execute)

  if ('key' in req) {
    return this.keeper.put(req.key, req.value)
      .then(sendTx)
  }
  else return sendTx()

  function sendTx () {
    return Q.ninvoke(wallet, 'sendTx', req.tx)
      .then(function () {
        delete req.execute
        return req
      })
  }
}

module.exports = ShareRequest
