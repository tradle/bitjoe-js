'use strict';

var crypto = require('crypto');
var bitcoin = require('bitcoinjs-lib');
// var base58 = require('bs58');
var assert = require('assert');
var rng = require('secure-random').randomBuffer;
var ALGORITHM = 'aes-256-ctr'; // TODO: use GCM with iv
var BIP39 = require('bip39');
var constants = require('./constants');

var CryptoUtils = {
  ENCRYPTION_ALGORITHM: ALGORITHM,

  generateMnemonic: function() {
    return BIP39.entropyToMnemonic(
      rng(128 / 8).toString('hex')
    );
  },

  idFromSeed: function(seed) {
    return crypto.createHash('sha256')
      .update(seed)
      .digest('hex');
  },

  accountsFromSeed: function(seed, networkName) {
    assert(seed && networkName, 'both seed and networkName are required');

    var network = bitcoin.networks[networkName]
    var accountZero = bitcoin.HDNode.fromSeedHex(seed, network).deriveHardened(0);

    var accounts = {};
    for (var account in constants.accounts) {
      accounts[account] = accountZero.derive(constants.accounts[account]);
    }

    return accounts;
  }
}

module.exports = CryptoUtils;
