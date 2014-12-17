
'use strict';

var crypto = require('crypto');
var bitcoin = require('bitcoinjs-lib');
var assert = require('assert');
var rng = require('secure-random').randomBuffer; 
var ALGORITHM = 'aes-256-ctr'; // TODO: use GCM with iv
var CIPHERTEXT_ENCODING = 'hex';
var CLEARTEXT_ENCODING = 'utf8';
var KEY_ENCODING = 'base64';
var EC = require('elliptic').ec;
var secp256k1 = new EC('secp256k1');
var BIP39 = require('bip39');
var common = require('./common');
// var iv = 'o0Q5H1ODEbMpVIYWxIlyPg';

var CryptoUtils = {
  CIPHERTEXT_ENCODING: CIPHERTEXT_ENCODING,
  CLEARTEXT_ENCODING: CLEARTEXT_ENCODING,
  KEY_ENCODING: KEY_ENCODING,
  ENCRYPTION_ALGORITHM: ALGORITHM,

  ciphertextToString: function(ciphertextBuffer) {
    return ciphertextBuffer.toString(CIPHERTEXT_ENCODING);
  },

  ciphertextToBuf: function(ciphertext) {
    return new Buffer(ciphertext, CIPHERTEXT_ENCODING);
  },

  keyToString: function(keyBuffer) {
    return keyBuffer.toString(KEY_ENCODING);
  },

  keyToBuf: function(key) {
    return new Buffer(key, KEY_ENCODING);
  },

  getStorageKeyFor: function(data) {
    return common.toBase58(
      crypto.createHash('sha256').update(data).digest('hex')
    );
  },

  encrypt: function(text, password) {
    if (typeof password === 'undefined')
      password = crypto.randomBytes(128);

    var cipher = crypto.createCipher(ALGORITHM, password);
    var crypted = cipher.update(text, CLEARTEXT_ENCODING, CIPHERTEXT_ENCODING);
    crypted += cipher.final(CIPHERTEXT_ENCODING);
    return crypted;
  },
   
  decrypt: function(text, password) {
    var decipher = crypto.createDecipher(ALGORITHM, password);
    var dec = decipher.update(text, CIPHERTEXT_ENCODING, CLEARTEXT_ENCODING);
    dec += decipher.final(CLEARTEXT_ENCODING);
    return dec;
  },

  sharedSecret: function(ec, aPriv, bPub) {
    if (typeof bPub === 'undefined') {
      bPub = aPriv;
      aPriv = ec;
      ec = secp256k1;
    }

    return ec.keyPair(aPriv).derive(bPub);
  },

  sharedEncryptionKey: function(ec, aPriv, bPub) {
    var sharedSecret = CryptoUtils.sharedSecret(ec, aPriv, bPub);
    return crypto.createHash('sha256').update(sharedSecret).digest('base64');
  },

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

    return {
      externalAccount: accountZero.derive(0),
      internalAccount: accountZero.derive(1)
    }
  }

  // encrypt: function(text, key) {
  //   var cipher = crypto.createCipheriv(algorithm, key, iv);
  //   var encrypted = cipher.update(text, 'utf8', 'hex');
  //   encrypted += cipher.final('hex');
  //   var tag = cipher.getAuthTag();
  //   return {
  //     content: encrypted,
  //     tag: tag
  //   };
  // },
   
  // decrypt: function(encrypted, key, iv) {
  //   var decipher = crypto.createDecipheriv(algorithm, key, iv);
  //   decipher.setAuthTag(encrypted.tag);
  //   var dec = decipher.update(encrypted.content, 'hex', 'utf8');
  //   dec += decipher.final('utf8');
  //   return dec;
  // }
}

module.exports = CryptoUtils;