'use strict'

var common = require('./lib/common')
var requests = require('./lib/requests')
var extend = require('extend')
var KeeperAPI = require('bitkeeper-client-js')
var utils = require('tradle-utils')
var typeforce = require('typeforce')
var Charger = require('testnet-charger')

module.exports = BitJoe

function BitJoe (options) {
  typeforce({
    wallet: 'Object'
  }, options)

  typeforce({
    priv: 'Object',
    pub: 'Object',
    addressString: 'String',
    balance: 'Function'
  }, options.wallet)

  utils.bindPrototypeFunctions(this)

  this._plugins = Object.create(null)
  this._options = extend({}, options || {})
  var keeper = this.option('keeper')
  this._keeper = keeper.isKeeper ? keeper : new KeeperAPI(keeper)

  this._dbs = {}
  this._wallet = options.wallet
}

/**
 *  Proxy function to create a new TransactionRequest
 */
BitJoe.prototype.create =
  BitJoe.prototype.transaction = function () {
    return new requests.TransactionRequest(this.requestConfig())
  }

BitJoe.prototype.share = function () {
  return new requests.ShareRequest(this.requestConfig())
}

BitJoe.prototype.requestConfig = function () {
  var conf = common.pick(this._options, 'prefix', 'minConf', 'networkName')
  conf.addressBook = this._addressBook
  conf.keeper = this._keeper
  conf.wallet = this._wallet
  return conf
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

BitJoe.prototype.withdrawFromFaucet = function (amount) {
  return this.charge(1, amount)
}

/**
 * @param n - number of addresses to charge
 * @param perAddr - amount to charge each address
 */
BitJoe.prototype.charge = function (n, perAddr, cb) {
  if (!this.isTestnet()) return cb(new Error('can only withdraw from faucet on testnet'))

  var wallet = this._wallet
  var c = new Charger(wallet)

  for (var i = 0; i < n; i++) {
    // yes, same address multiple times
    // we only have one in this wallet!
    c.charge(wallet.addressString, perAddr)
  }

  c.execute(cb)
}

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
