'use strict'

var assert = require('assert')
var EventEmitter = require('events').EventEmitter
var inherits = require('util').inherits
var once = require('once')
var bitcoin = require('bitcoinjs-lib')
var crypto = require('crypto')
var common = require('../common')
var utils = require('tradle-utils')
var Q = require('q')
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

  this._recipients = uniq(pubKeys)
  return this
}

TransactionRequest.prototype.setPublic = function (isPublic) {
  typeForce('Boolean', isPublic)
  this._public = isPublic
  this._cleartext = isPublic
  return this
}

TransactionRequest.prototype.build = function () {
  var self = this

  if (self._value) throw new Error('already built or building')
  if (!self._recipients || !self._recipients.length) {
    // share with self
    if (self._public) {
      self._recipients.push(self.wallet.pub)
    } else {
      throw new Error('no recipients')
    }
  }

  if (!self._public) self._encrypt()

  self._value = self._encryptedData || self._dataBuf
  var req = {
    value: self._value
  }

  return Q.ninvoke(utils, 'getStorageKeyFor', self._value)
    .then(function (key) {
      self._key = key
      req.key = key.toString('hex')

      return Q.all(
        self._recipients.map(self._buildShare)
      )
    })
    .then(function (results) {
      if (results.length) {
        req.shares = results
      }

      req.execute = once(self.execute.bind(self, req))
      return req
    })
}

TransactionRequest.prototype.execute = function (req) {
  var self = this

  if (!req) return this.build().then(this.execute)

  return this.keeper.put(req.key, req.value)
    .then(function () {
      return self._share(req)
    })
    .then(function () {
      delete req.execute
      return req
    })
}

TransactionRequest.prototype._generateSymmetricKey = function () {
  return crypto.randomBytes(32)
}

TransactionRequest.prototype._encrypt = function () {
  this._symmetricKey = this._generateSymmetricKey()
  this._encryptedData = utils.encrypt(this._dataBuf, this._symmetricKey)
}

TransactionRequest.prototype._share = function (req) {
  var tasks = req.shares.map(function (req) {
    return req.execute()
  })

  return Q.all(tasks)
    .then(function () {
      return req
    })
}

TransactionRequest.prototype._buildShare = function (pubKey) {
  return new ShareRequest(this._options)
    .shareAccessTo(this._key, this._symmetricKey)
    .shareAccessWith(pubKey)
    .setPublic(this._public || false)
    // .cleartext(this._cleartext || false)
    .build()
}

module.exports = TransactionRequest
