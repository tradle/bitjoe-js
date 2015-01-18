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
var createTorrent = require('create-torrent');
var parseTorrent = require('parse-torrent');
// var iv = 'o0Q5H1ODEbMpVIYWxIlyPg';

var CryptoUtils = {
  // KEY_ENCODING: KEY_ENCODING,
  ENCRYPTION_ALGORITHM: ALGORITHM,

  toHumanReadableString: function (keyBuf) {
    // return typeof keyBuf === 'string' ? keyBuf : base58.encode(keyBuf);
    return typeof keyBuf === 'string' ? keyBuf : keyBuf.toString('hex');
  },

  fromHumanReadableString: function (keyStr) {
    // return keyStr instanceof Buffer ? keyStr : new Buffer(base58.decode(keyStr));
    return keyStr instanceof Buffer ? keyStr : new Buffer(keyStr, 'hex');
  },

  keyToString: function (buf) {
    return typeof buf === 'string' ? buf : buf.toString('base64');
  },

  keyToBuf: function (str) {
    return str instanceof Buffer ? str : new Buffer(str, 'base64');
  },

  // fileToString: function(buf) {
  //   return typeof buf === 'string' ? buf : buf.toString();
  // },

  fileToBuf: function (str) {
    return str instanceof Buffer ? str : new Buffer(str);
  },

  getStorageKeyFor: function (data) {
    return Q.ninvoke(utils, 'getInfoHash', data).then(function (infoHash) {
      return new Buffer(infoHash, 'hex');
    });

    // .get('infoHash');
    // return crypto.createHash('sha256').update(data).digest();
  },

  encrypt: function (text, password) {
    assert(text && password, 'text and password are both required');

    if (text instanceof Buffer) return CryptoUtils.encryptBuf(text, password);

    var cipher = crypto.createCipher(ALGORITHM, password);
    var crypted = cipher.update(text, 'utf8', 'base64');
    crypted += cipher.final('base64');

    return crypted;
  },

  decrypt: function (text, password) {
    assert(text && password, 'text and password are both required');

    if (text instanceof Buffer) return CryptoUtils.decryptBuf(text, password);

    var decipher = crypto.createDecipher(ALGORITHM, password);
    var dec = decipher.update(text, 'base64', 'utf8');
    dec += decipher.final('utf8');
    return dec;
  },

  encryptBuf: function (buf, pass) {
    assert(buf && pass, 'buf and pass are both required');

    var cipher = crypto.createCipher(ALGORITHM, pass)
    var crypted = Buffer.concat([cipher.update(buf), cipher.final()]);
    return crypted;
  },

  decryptBuf: function (buf, pass) {
    assert(buf && pass, 'buf and pass are both required');

    var decipher = crypto.createDecipher(ALGORITHM, pass)
    var dec = Buffer.concat([decipher.update(buf), decipher.final()]);
    return dec;
  },

  sharedSecret: function (ec, aPriv, bPub) {
    if (typeof bPub === 'undefined') {
      bPub = aPriv;
      aPriv = ec;
      ec = secp256k1;
    }

    aPriv = aPriv.d || aPriv;
    return bPub.Q.multiply(aPriv).getEncoded();
  },

  sharedEncryptionKey: function (ec, aPriv, bPub) {
    var sharedSecret = CryptoUtils.sharedSecret(ec, aPriv, bPub);
    return crypto.createHash('sha256').update(sharedSecret).digest();
  },

  generateMnemonic: function () {
    return BIP39.entropyToMnemonic(
      rng(128 / 8).toString('hex')
    );
  },

  idFromSeed: function (seed) {
    return crypto.createHash('sha256')
      .update(seed)
      .digest('hex');
  },

  accountsFromSeed: function (seed, networkName) {
    assert(seed && networkName, 'both seed and networkName are required');

    var network = bitcoin.networks[networkName]
    var accountZero = bitcoin.HDNode.fromSeedHex(seed, network).deriveHardened(0);

    return {
      externalAccount: accountZero.derive(0),
      internalAccount: accountZero.derive(1)
    }
  }
}

module.exports = CryptoUtils;
