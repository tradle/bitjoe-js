'use strict';

var bitcoin = require('bitcoinjs-lib');
var Wallet = require('cb-wallet');
var assert = require('assert');
var commonBlockchains = require('./commonBlockchains');
var Q = require('q');

// COPIED FROM cb-blockr
var NETWORKS = {
  testnet: 'tbtc',
  bitcoin: 'btc',
  litecoin: 'ltc'
}

Array.prototype.remove = function(value) {
  var idx = this.indexOf(value);
  if (idx !== -1) return this.splice(idx, 1); // The second parameter is the number of elements to remove.

  return false;
}

var Common = {
  prefix: 'tradle',
  permissionCost: function(network) {
    return bitcoin.networks[network].dustThreshold + 1;
  },

  toBuffer: function(str, encoding) {
    if (Buffer.isBuffer(str)) return str;

    return new Buffer(str, encoding || 'binary');
  },

  pushUniq: function(a, b) {
    for (var i = 0; i < b.length; i++) {
      if (a.indexOf(b[i]) === -1)
        a.push(b[i]);
    }
  },

  requireParam: function(req, param) {
    var params = req.method === 'POST' ? req.body : req.query;

    if (!params || !(param in params)) throw Common.httpError(400, 'Missing required parameter: ' + param);

    return params[param];
  },

  walletFromJSON: function(json) {
    return Wallet.deserialize(json);
  },

  prettify: function(pojo) {
    return JSON.stringify(pojo, null, 2);
  },

  getOpReturnData: function(tx) {
    for (var i = 0; i < tx.outs.length; i++) {
      var out = tx.outs[i];
      if (bitcoin.scripts.isNullDataOutput(out.script))
        return out.script.chunks[1];
    }
  },

  getTransactionUrl: function(networkName, txId) {
    assert(networkName && txId, 'Network name and txId are required');
    txId = txId.getId ? txId.getId() : txId;
    return 'http://' + NETWORKS[networkName] + '.blockr.io/tx/info/' + txId;
  },

  /**
   *  Normalize to instance of bitcoin.ECPubKey
   */
  toPubKey: function(pubKey) {
    assert(typeof pubKey === 'string' || pubKey instanceof bitcoin.ECPubKey, 'Please provide a public key hex string or an instance of ECPubKey');

    return typeof pubKey === 'string' ? bitcoin.ECPubKey.fromHex(pubKey) : pubKey;
  },

  currentBlockHeight: function(networkName) {
    var blocks = commonBlockchains(networkName).blocks;
    return Q.ninvoke(blocks, 'latest')
      .then(function(block) {
        return block.blockHeight;
      });
  }
}

module.exports = Common;
