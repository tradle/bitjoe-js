'use strict'

var bitcoin = require('bitcoinjs-lib')
var assert = require('assert')

// COPIED FROM cb-blockr
var NETWORKS = {
  testnet: 'tbtc',
  bitcoin: 'btc',
  litecoin: 'ltc'
}

module.exports = {
  prefix: 'tradle',
  permissionCost: function (network) {
    return bitcoin.networks[network].dustThreshold + 1
  },

  toBuffer: function (str, encoding) {
    if (Buffer.isBuffer(str)) return str

    return new Buffer(str, encoding || 'binary')
  },

  pushUniq: function (a, b) {
    for (var i = 0; i < b.length; i++) {
      if (a.indexOf(b[i]) === -1) {
        a.push(b[i])
      }
    }
  },

  getOpReturnData: function (tx) {
    if (typeof tx === 'string') tx = bitcoin.Transaction.fromHex(tx)

    for (var i = 0; i < tx.outs.length; i++) {
      var out = tx.outs[i]
      if (bitcoin.scripts.isNullDataOutput(out.script)) {
        return out.script.chunks[1]
      }
    }
  },

  getTransactionUrl: function (networkName, txId) {
    assert(networkName && txId, 'Network name and txId are required')
    txId = txId.getId ? txId.getId() : txId
    return 'http://' + NETWORKS[networkName] + '.blockr.io/tx/info/' + txId
  },

  /**
   *  Normalize to instance of bitcoin.ECPubKey
   */
  toPubKey: function (pubKey) {
    if (Buffer.isBuffer(pubKey)) return bitcoin.ECPubKey.fromBuffer(pubKey)
    else if (typeof pubKey === 'string') return bitcoin.ECPubKey.fromHex(pubKey)

    return pubKey
  },

  pick: function (obj) {
    var keys = arguments
    var idx = 1
    if (Array.isArray(arguments[1])) {
      keys = arguments[1]
      idx = 0
    }

    var picked = {}
    for (var i = idx; i < keys.length; i++) {
      var key = keys[i]
      picked[key] = obj[key]
    }

    return picked
  }
}
