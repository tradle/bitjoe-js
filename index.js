'use strict'

var common = require('./lib/common')
var requests = require('./lib/requests')
var extend = require('extend')
var utils = require('@tradle/utils')
var typeforce = require('typeforce')
// var Charger = require('testnet-charger')

module.exports = BitJoe

function BitJoe (options) {
  typeforce({
    wallet: 'Object',
    keeper: 'Object',
    networkName: 'String',
    minConf: 'Number',
    prefix: 'String'
  }, options)

  typeforce({
    priv: 'Object',
    pub: 'Object',
    addressString: 'String',
    balance: 'Function'
  }, options.wallet)

  typeforce({
    put: 'Function',
    getOne: 'Function',
    getMany: 'Function'
  }, options.keeper)

  utils.bindPrototypeFunctions(this)

  this._options = extend({}, options || {})
  this._keeper = this.option('keeper')
  this._plugins = Object.create(null)
  this._dbs = {}
  this._wallet = options.wallet
}

BitJoe.prototype.create = function (options) {
  return new requests.Create(extend({}, this.requestConfig(), options || {}))
}

BitJoe.prototype.share = function (options) {
  return new requests.Share(extend({}, this.requestConfig(), options || {}))
}

BitJoe.prototype.chain = function (options) {
  return new requests.Chain(extend({}, this.requestConfig(), options || {}))
}

BitJoe.prototype.requestConfig = function () {
  return common.pick(this._options,
    'prefix',
    'minConf',
    'networkName',
    'keeper',
    'wallet'
  )
}

BitJoe.prototype.wallet = function () {
  return this._wallet
}

// backwards compatible
BitJoe.prototype.config =
BitJoe.prototype.option = function (option) {
  return typeof option === 'undefined' ? this._options : this._options[option]
}

BitJoe.prototype.isTestnet = function () {
  return this.option('networkName') === 'testnet'
}

BitJoe.prototype.keeper = function () {
  return this._keeper
}

// BitJoe.prototype.withdrawFromFaucet = function (amount) {
//   return this.charge(1, amount)
// }

/**
 * @param n - number of addresses to charge
 * @param perAddr - amount to charge each address
 */
// BitJoe.prototype.charge = function (n, perAddr, cb) {
//   if (!this.isTestnet()) return cb(new Error('can only withdraw from faucet on testnet'))

//   var wallet = this._wallet
//   var c = new Charger(wallet)

//   for (var i = 0; i < n; i++) {
//     // yes, same address multiple times
//     // we only have one in this wallet!
//     c.charge(wallet.addressString, perAddr)
//   }

//   c.execute(cb)
// }

BitJoe.prototype.balance = function (cb) {
  return this._wallet.balance(cb)
}

BitJoe.prototype.isTestnet = function () {
  return this.networkName() === 'testnet'
}

BitJoe.prototype.destroy = function () {}

BitJoe.prototype.networkName = function () {
  return this.option('networkName')
}
