
var assert = require('assert')
var typeforce = require('typeforce')
var extend = require('extend')
var Q = require('q')
var bitcoin = require('bitcoinjs-lib')
var utils = require('tradle-utils')
var TxData = require('tradle-tx-data').TxData
var common = require('../common')
var DEFAULT_FEE = 20000

module.exports = ChainRequest

function ChainRequest (options) {
  typeforce({
    wallet: 'Object',
    networkName: 'String',
    prefix: 'String',
    minConf: '?Number'
  }, options)

  extend(this, options)
  utils.bindPrototypeFunctions(this)
  this.network = bitcoin.networks[this.networkName]
}

ChainRequest.prototype.publish = function () {
  return this.type(TxData.types.public)
}

ChainRequest.prototype.share = function () {
  return this.type(TxData.types.permission)
}

ChainRequest.prototype.type = function (type) {
  return this._setType(type)
}

ChainRequest.prototype._setType = function (type) {
  if ('_type' in this && this._type !== type) {
    throw new Error('"publish" or "share" but not both')
  }

  assert(type === TxData.types.public || type === TxData.types.permission)
  this._type = type
  return this
}

/**
 * data to put in OP_RETURN
 * @param  {String|Buffer} data - hex string or buffer
 * @return {ChainRequest} this instance
 */
ChainRequest.prototype.data = function (data) {
  if (typeof data === 'string') data = new Buffer(data, 'hex')

  this._data = data
  return this
}

ChainRequest.prototype.fee = function (fee) {
  this._fee = fee
  return this
}

ChainRequest.prototype.to =
ChainRequest.prototype.address = function (address) {
  if (typeof address === 'string') {
    bitcoin.Address.fromBase58Check(address) // validate
  } else if (address instanceof bitcoin.Address) {
    address = address.toString()
  } else {
    throw new Error('invalid address')
  }

  this._address = address
  return this
}

ChainRequest.prototype.build = function () {
  if (!this._address) {
    this._address = this.wallet.addressString
  }

  typeforce({
    _data: 'Buffer',
    _type: 'Number',
    _address: 'String'
  }, this)

  var txData = new TxData(this.prefix, this._type, this._data)
  var builder = this.wallet
    .send()
    .fee(this._fee || DEFAULT_FEE)
    .to(this._address, common.permissionCost(this.networkName))
    .data(txData.serialize())

  return Q.ninvoke(builder, 'build')
    .then(function (tx) {
      // builder may return unspents used as second arg
      return Array.isArray(tx) ? tx[0] : tx
    })
}

ChainRequest.prototype.execute = function (tx) {
  if (!tx) return this.build().then(this.execute)

  return Q.ninvoke(this.wallet, 'sendTx', tx)
}
