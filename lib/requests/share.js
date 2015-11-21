var inherits = require('util').inherits
var EventEmitter = require('events').EventEmitter
var utils = require('tradle-utils')
var extend = require('extend')
var once = require('once')
var Permission = require('tradle-permission')
var EventEmitter = require('events').EventEmitter
var typeforce = require('typeforce')
var bitcoin = require('@tradle/bitcoinjs-lib')
var Q = require('q')
var common = require('../common')

function ShareRequest (options) {
  EventEmitter.call(this)

  typeforce({
    keeper: 'Object',
    networkName: 'String',
    wallet: 'Object'
  }, options)

  extend(this, options)
  utils.bindPrototypeFunctions(this)
  this.network = bitcoin.networks[this.networkName]
}

inherits(ShareRequest, EventEmitter)

ShareRequest.prototype.shareAccessTo = function (fileKey, fileEncryptionKey) {
  this._fileKey = fileKey
  this._encryptionKey = fileEncryptionKey
  return this
}

/**
 * Share access with another party
 * @param  {ECPubKey|Address} party [description]
 * @return {ShareRequest}  this instance
 */
ShareRequest.prototype.shareAccessWith = function (party) {
  var pubKey
  var addr
  if (typeof party === 'string') {
    try {
      pubKey = common.toPubKey(party)
      addr = pubKey.getAddress(this.network).toString()
    } catch (err) {
      try {
        bitcoin.Address.fromBase58Check(party)
        addr = party
      } catch (err) {
      }
    }
  } else {
    if (party instanceof bitcoin.ECPubKey || party.getAddress) {
      pubKey = party
      addr = pubKey.getAddress(this.network).toString()
    } else {
      addr = party.toString()
    }
  }

  if (!addr) throw new Error('party must be ECPubKey or Address')

  this.recipientPubKey = pubKey
  this.recipientAddress = addr
  return this
}

ShareRequest.prototype.build = function () {
  var self = this

  typeforce({
    recipientPubKey: 'Object'
  }, this)

  var permission = new Permission(this._fileKey, this._encryptionKey)
  var encKey = utils.sharedEncryptionKey(this.wallet.priv, this.recipientPubKey)
  permission.encrypt(encKey)
  return Q.ninvoke(permission, 'build')
    .then(function () {
      return {
        key: permission.key().toString('hex'),
        encryptedKey: permission.encryptedKey().toString('hex'),
        value: permission.data(),
        permission: permission,
        pubKey: self.recipientPubKey,
        address: self.recipientAddress,
        execute: once(self.execute.bind(self))
      }
    })
}

ShareRequest.prototype.execute = function (req) {
  if (!req) return this.build().then(this.execute)

  return this.keeper.put(req.key, req.value)
    .then(function () {
      delete req.execute
      return req
    })
}

module.exports = ShareRequest
