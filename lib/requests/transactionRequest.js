'use strict'

var assert = require('assert')
var EventEmitter = require('events').EventEmitter
var inherits = require('util').inherits
var bitcoin = require('bitcoinjs-lib')
var crypto = require('crypto')
var common = require('../common')
var utils = require('tradle-utils')
var Q = require('q')
var debug = require('debug')('transaction-request')
var typeForce = require('typeforce')
var uniq = require('uniq')
var extend = require('extend')
var ShareRequest = require('./shareRequest')

function TransactionRequest (options) {
  EventEmitter.call(this)

  typeForce({
    wallet: 'Object',
    keeper: 'Object',
    networkName: 'String',
    minConf: 'Number',
    prefix: 'String'
  }, options)

  this._options = options
  extend(this, options)

  utils.bindPrototypeFunctions(this)

  this.network = bitcoin.networks[this.networkName]
  this._recipients = []
}

inherits(TransactionRequest, EventEmitter)

TransactionRequest.prototype.data = function (data) {
  assert(data, 'Missing required parameter: data')

  this._data = data
  if (typeof data === 'string') {
    this._dataBuf = new Buffer(data)
  } else if (Buffer.isBuffer(data)) {
    this._dataBuf = data
  } else if (typeof data === 'object') {
    this._dataBuf = new Buffer(JSON.stringify(data))
  } else {
    throw new TypeError('Parameter "data" can be one of the following types: String, Buffer, POJO')
  }

  // TODO: take into account size of payload
  this._permissionCost = common.permissionCost(this.networkName)

  return this
}

TransactionRequest.prototype.shareWith =
  TransactionRequest.prototype.recipients = function (pubKeys) {
    if (!Array.isArray(pubKeys)) pubKeys = [pubKeys]

    this._recipients = uniq(pubKeys).map(common.toPubKey)
    return this
  }

TransactionRequest.prototype.setPublic = function (isPublic) {
  typeForce('Boolean', isPublic)
  this._public = isPublic
  this._cleartext = isPublic
  return this
}

TransactionRequest.prototype.execute = function () {
  var self = this

  if (!this._public) this._encrypt()

  this._value = this._encryptedData || this._dataBuf
  var resp
  return Q.ninvoke(utils, 'getStorageKeyFor', this._value)
    .then(function (key) {
      self._key = key
      return self._share()
    })
    .then(function (_resp) {
      resp = _resp
      return self.keeper.put(self._key.toString('hex'), self._value)
    })
    .then(function () {
      return resp
    })
}

TransactionRequest.prototype._generateSymmetricKey = function () {
  return crypto.randomBytes(32)
}

TransactionRequest.prototype._encrypt = function () {
  this._symmetricKey = this._generateSymmetricKey()
  this._encryptedData = utils.encrypt(this._dataBuf, this._symmetricKey)
}

TransactionRequest.prototype._share = function () {
  var self = this
  if (!this._recipients || !this._recipients.length) {
    // share with self
    if (this._public) {
      this._recipients.push(this.wallet.pub)
    } else {
      throw new Error('no recipients')
    }
  }

  var tasks = this._recipients.map(this._shareWith)

  return Q.all(tasks)
    .then(function (results) {
      var fileKey = self._key.toString('hex') // infoHash
      var resp = {
        fileKey: fileKey,
        permissions: {},
        public: {}
      }

      if (self.keeper.urlFor) resp.fileUrl = self.keeper.urlFor(fileKey)

      results.forEach(function (info, idx) {
        var pubKey = self._recipients[idx].toHex()
        var shareInfo = {
          txId: info.tx.getId(),
          txUrl: common.getTransactionUrl(self.networkName, info.tx.getId())
        }

        if (info.permission) {
          shareInfo.key = info.permission.key().toString('hex') // infoHash
          if (self.keeper.urlFor) shareInfo.fileUrl = self.keeper.urlFor(shareInfo.key)

          resp.permissions[pubKey] = shareInfo
        } else if (self._public) {
          resp['public'][pubKey] = shareInfo
        }
      })

      debug(resp)
      return resp
    })
}

TransactionRequest.prototype._shareWith = function (pubKey) {
  return new ShareRequest(this._options)
    .shareAccessTo(this._key, this._symmetricKey)
    .shareAccessWith(pubKey)
    .setPublic(this._public || false)
    // .cleartext(this._cleartext || false)
    .execute()
}

module.exports = TransactionRequest
