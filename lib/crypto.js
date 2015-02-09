'use strict';

var crypto = require('crypto');
var bitcoin = require('bitcoinjs-lib');
var utils = require('tradle-utils');
// var base58 = require('bs58');
var assert = require('assert');
var rng = require('secure-random').randomBuffer;
var ALGORITHM = 'aes-256-ctr'; // TODO: use GCM with iv
// var KEY_ENCODING = 'base64';
var EC = require('elliptic').ec;
var secp256k1 = new EC('secp256k1');
var BIP39 = require('bip39');
var Q = require('q');
var constants = require('./constants');
var CTR = 'aes-256-ctr';
var GCM = 'aes-256-gcm';
var IV_LENGTH = 12; // bytes
var TAG_LENGTH = 16; // bytes

var CryptoUtils = {
  // KEY_ENCODING: KEY_ENCODING,
  ENCRYPTION_ALGORITHM: ALGORITHM,

  toHumanReadableString: function(keyBuf) {
    // return typeof keyBuf === 'string' ? keyBuf : base58.encode(keyBuf);
    return typeof keyBuf === 'string' ? keyBuf : keyBuf.toString('hex');
  },

  fromHumanReadableString: function(keyStr) {
    // return keyStr instanceof Buffer ? keyStr : new Buffer(base58.decode(keyStr));
    return Buffer.isBuffer(keyStr) ? keyStr : new Buffer(keyStr, 'hex');
  },

  keyToString: function(buf) {
    return typeof buf === 'string' ? buf : buf.toString('base64');
  },

  keyToBuf: function(str) {
    return Buffer.isBuffer(str) ? str : new Buffer(str, 'base64');
  },

  // fileToString: function(buf) {
  //   return typeof buf === 'string' ? buf : buf.toString();
  // },

  fileToBuf: function(str) {
    return Buffer.isBuffer(str) ? str : new Buffer(str);
  },

  getStorageKeyFor: function(data) {
    return Q.ninvoke(utils, 'getInfoHash', data).then(function(infoHash) {
      return new Buffer(infoHash, 'hex');
    });

    // .get('infoHash');
    // return crypto.createHash('sha256').update(data).digest();
  },

  sharedSecret: function(ec, aPriv, bPub) {
    if (typeof bPub === 'undefined') {
      bPub = aPriv;
      aPriv = ec;
      ec = secp256k1;
    }

    aPriv = aPriv.d || aPriv;
    return bPub.Q.multiply(aPriv).getEncoded();
  },

  sharedEncryptionKey: function(ec, aPriv, bPub) {
    var sharedSecret = CryptoUtils.sharedSecret(ec, aPriv, bPub);
    return crypto.createHash('sha256').update(sharedSecret).digest();
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

    var accounts = {};
    for (var account in constants.accounts) {
      accounts[account] = accountZero.derive(constants.accounts[account]);
    }

    return accounts;
  },

  encrypt: function(text, password) {
    assert(text && password, 'text and password are both required');

    var cipher = crypto.createCipher(CTR, password);
    return updateCipher(cipher, text);
  },

  decrypt: function(text, password) {
    assert(text && password, 'text and password are both required');

    var decipher = crypto.createDecipher(CTR, password);
    return updateDecipher(decipher, text);
  },

  encryptGCM: function(data, key) {
    if (typeof key === 'string') key = new Buffer(key, 'hex');

    var iv = crypto.randomBytes(IV_LENGTH);
    var cipher = crypto.createCipheriv(GCM, key, iv)
    var encrypted = updateCipher(cipher, data);
    var tag = cipher.getAuthTag();
    return Buffer.concat([iv, new Buffer(encrypted, 'base64'), tag]);
  },

  decryptGCM: function(ciphertext, key) {
    if (typeof key === 'string') key = new Buffer(key, 'hex');

    var iv = ciphertext.slice(0, IV_LENGTH);
    var tag = ciphertext.slice(ciphertext.length - TAG_LENGTH);
    ciphertext = ciphertext.slice(IV_LENGTH, ciphertext.length - TAG_LENGTH);

    var decipher = crypto.createDecipheriv(GCM, key, iv);
    decipher.setAuthTag(tag);

    var dec = updateDecipher(decipher, ciphertext);
    return new Buffer(dec, 'utf8');
  }
}

function updateCipher(cipher, data) {
  if (Buffer.isBuffer(data)) return Buffer.concat([cipher.update(data), cipher.final()]);
  else return cipher.update(data, 'utf8', 'base64') + cipher.final('base64');
}

function updateDecipher(decipher, data) {
  if (Buffer.isBuffer(data)) return Buffer.concat([decipher.update(data), decipher.final()]);
  else return decipher.update(data, 'base64', 'utf8') + decipher.final('utf8');
}

module.exports = CryptoUtils;
