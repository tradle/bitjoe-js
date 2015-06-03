'use strict'

var EventEmitter = require('events').EventEmitter
var common = require('./lib/common')
var EventEmitter = require('events').EventEmitter
var inherits = require('util').inherits
var requests = require('./lib/requests')
var extend = require('extend')
var KeeperAPI = require('bitkeeper-client-js')
var debug = require('debug')('bitjoe')
var utils = require('tradle-utils')
var typeforce = require('typeforce')
var Charger = require('testnet-charger')

module.exports = BitJoe

function BitJoe (config) {
  typeforce({
    wallet: 'Object'
  }, config)

  EventEmitter.call(this)

  utils.bindPrototypeFunctions(this)

  this._plugins = Object.create(null)
  this._config = extend({}, config || {})
  var keeper = this.config('keeper')
  this._keeper = keeper.isKeeper ? keeper : new KeeperAPI(keeper)

  this._dbs = {}
  this._wallet = config.wallet
  this.init()
}

inherits(BitJoe, EventEmitter)

BitJoe.prototype.init = function () {
  var self = this

  if (this._ready) return

  this._ready = true

  console.log('Fund me at ' + this._wallet.addressString)
  debug('Pub key:', this._wallet.pub.toHex())
  // test mode
  this.balance(function (err, balance) {
    if (err) return self.emit('error', err)

    console.log('Balance: ' + balance)
  })
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
  var conf = common.pick(this._config, 'prefix', 'minConf', 'networkName')
  conf.addressBook = this._addressBook
  conf.keeper = this._keeper
  conf.wallet = this._wallet
  return conf
}

BitJoe.prototype.wallet = function () {
  return this._wallet
}

BitJoe.prototype.config = function (configOption) {
  return typeof configOption === 'undefined' ? this._config : this._config[configOption]
}

BitJoe.prototype.isTestnet = function () {
  return this.config('networkName') === 'testnet'
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
  return this.config('networkName')
}
