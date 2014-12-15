
'use strict';

var bitcoin = require('bitcoinjs-lib')
var _ = require('lodash');
var commonBlockchains = require('../commonBlockchains');

function TransactionDiscovery() {}

TransactionDiscovery.prototype.networkName = function(networkName) {
  this._networkName = networkName;
  return this;
}

TransactionDiscovery.prototype.addresses = function(addresses) {
  this._addresses = [].concat.apply([], arguments);
  return this;
}

TransactionDiscovery.prototype.commonBlockchain = function(commonBlockchain) {
  this._commonBlockchain = commonBlockchain;
  return this;
}

TransactionDiscovery.prototype.blockHeight = function(blockHeight) {
  this._blockHeight = blockHeight;
  return this;
}

TransactionDiscovery.prototype.discover = function(cb) {
  var networkName = this._networkName || 'bitcoin';
  var commonBlockchain = this._commonBlockchain || commonBlockchains(networkName);
  var addresses = this._addresses;
  var blockHeight = this._blockHeight || 0;
  return fetchTransactions({
    addresses: addresses,
    commonBlockchain: commonBlockchain,
    blockHeight: blockHeight
  }, cb);
}

function fetchTransactions(options, done) {
  var addresses = options.addresses;
  var commonBlockchain = options.commonBlockchain;
  var blockHeight = options.blockHeight;

  commonBlockchain.addresses.transactions(addresses, blockHeight, function(err, transactions) {
    if (err) return done(err);

    if (!transactions.length)
      return done(null, [], []);

    var parsed = parseTransactions(transactions);
    commonBlockchain.transactions.get(getAdditionalTxIds(parsed.txs), function(err, transactions) {
      if(err) return done(err);

      parsed = parseTransactions(transactions, parsed);
      done(null, parsed.txs, parsed.metadata);
    })
  })
}

function parseTransactions(transactions, initialValue) {
  initialValue = initialValue || {txs: [], metadata: {}}
  return transactions.reduce(function(memo, t) {
    var tx = bitcoin.Transaction.fromHex(t.txHex)
    memo.txs.push(tx)
    memo.metadata[tx.getId()] = _.pick(t, 'confirmations', 'timestamp', 'blockHeight');

    return memo
  }, initialValue)
}

function getAdditionalTxIds(txs) {
  var inputTxIds = txs.reduce(function(memo, tx) {
    tx.ins.forEach(function(input) {
      var hash = new Buffer(input.hash)
      Array.prototype.reverse.call(hash)
      memo[hash.toString('hex')] = true
    })
    return memo
  }, {})

  var txIds = txs.map(function(tx) { return tx.getId() })

  return Object.keys(inputTxIds).filter(function(id) {
    return txIds.indexOf(id) < 0
  })
}

module.exports = TransactionDiscovery;