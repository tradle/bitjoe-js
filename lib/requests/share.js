var inherits = require('util').inherits
var EventEmitter = require('events').EventEmitter
var extend = require('extend')
var once = require('once')
var typeforce = require('typeforce')
var Q = require('q')
var bitcoin = require('@tradle/bitcoinjs-lib')
var utils = require('@tradle/utils')
var Permission = require('@tradle/permission')
var common = require('../common')
var debug = common.debug

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

  debug('1. creating access object to share message ' + this._fileKey.toString('hex') + ' with ' + this.recipientAddress)
  var permission = new Permission(this._fileKey, this._encryptionKey)
  var encKey = utils.sharedEncryptionKey(this.wallet.priv, this.recipientPubKey)
  debug('2. encrypting access object for ' + this.recipientAddress + ' with ECDH key')
  debug('3. computing seal: encrypting access object hash with ECDH key')
  permission.encrypt(encKey)
  return Q.ninvoke(permission, 'build')
    .then(function () {
      var req = {
        key: permission.key().toString('hex'),
        encryptedKey: permission.encryptedKey().toString('hex'),
        value: permission.data(),
        permission: permission,
        pubKey: self.recipientPubKey,
        address: self.recipientAddress
      }

      debug('4. computed seal: ' + req.encryptedKey)
      req.execute = once(self.execute.bind(self, req))
      return req
    })
}

ShareRequest.prototype.execute = function (req) {
  if (!req) return this.build().then(this.execute)

  debug('5. storing access object in attached keeper')
  return this.keeper.put(req.key, req.value)
    .then(function () {
      delete req.execute
      return req
    })
}

module.exports = ShareRequest
