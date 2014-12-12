
'use strict';

var bitcoin = require('bitcoinjs-lib');
var crypto = require('crypto');
var CBWallet = require('cb-wallet');
var BIP39 = require('bip39');
// var BIP38 = require('bip38');
var EventEmitter = require('events').EventEmitter;
var inherits = require('util').inherits;
var rng = require('secure-random').randomBuffer; 
var denominations = require('./denominations');
var db = require('./db');
var fs = require('fs');
var extend = require('extend');

function Wallet(options) {
  if (!(this instanceof Wallet)) return new Wallet(options);

  EventEmitter.call(this);

  this._network = requireOption(options, 'network');

  if (options.seed) {
    this._seed = options.seed;
  }
  else {
    this._mnemonic = options.mnemonic || generateMnemonic();
    if (!BIP39.validateMnemonic(this._mnemonic))
      throw new Error('Invalid mnemonic');

    this._seed = BIP39.mnemonicToSeedHex(this._mnemonic);
  }

  this._id = crypto.createHash('sha256')
                   .update(this._seed)
                   .digest('hex');

  this._pin = this._id.slice(0, 4);
  this._calculateAcccountsFromSeed();
  this.emit('init', { 
    seed: this._seed,
    id: this._id,
    pin: this._pin
  });

  // proxy methods from underlying CBWallet instance
  for (var p in this._wallet) {
    if (typeof this._wallet[p] === 'function')
      this[p] = this._wallet[p].bind(this._wallet);
  }
}

inherits(Wallet, EventEmitter);

Wallet.fromFile = function(filePath, callback) {
  fs.readFile(filePath, function(err, buf) {
    // no wallet
    if (err) return callback(err);

    try {
      callback(null, Wallet.fromString(buf.toString('hex')));
    } catch (err) {
      callback(err);
    }
  });
}

Wallet.fromSeed = function(seed) {
  return new Wallet({
    seed: seed
  });
}

Wallet.fromPIN = function(pin) {
  throw new Error('unsupported');
}

/*
* Adapted from https://github.com/hivewallet/hive-js/blob/master/app/lib/wallet/index.js
*/
Wallet.prototype.save = function(options, callback) {
  if (options.file) return this._saveToFile(options, callback);
  if (options.db) return this._saveToDB(options, callback);

  throw new Error('File and DB storage are currently the only supported options');
}

Wallet.prototype._saveToFile = function(options, callback) {
  // TODO: encrypt

  var self = this;

  requireOption(options, 'path');

  if (options.overwrite)
    fs.writeFile(options.path, this.serialize(), callback);
  else {
    fs.exists(options.path, function(exists) {
      if (exists) return callback(new Error('Wallet file exists, to overwrite specify option: overwrite'));

      self.save(extend({ overwrite: true }, options));
    })
  }
}

Wallet.prototype._saveToDB = function(options, callback) {
  // TODO: encrypt

  db.saveEncryptedSeed(this._id, this._seed, callback);
}

Wallet.prototype._calculateAcccountsFromSeed = function() {
  var network = bitcoin.networks[this._network];
  var accountZero = bitcoin.HDNode.fromSeedHex(this._seed, network)
                                  .deriveHardened(0);

  this._accounts = {
    externalAccount: accountZero.derive(0),
    internalAccount: accountZero.derive(1)
  };
}

Wallet.prototype.getAccounts = function() {
  if (!this._accounts) this._calculateAcccountsFromSeed();

  return this._accounts;
}

Wallet.prototype._initWallet = function(callback) {
  var self = this;
  var accounts = this._accounts;
  this._wallet = new CBWallet(accounts.externalAccount, accounts.internalAccount, this._network, function(err) {
    if (err) return callback(err);

    self._denomination = denominations[self._network].default;

    var txObjs = self._wallet.getTransactionHistory();
    callback(null, txObjs.map(function(tx) {
      return self._parseTx(tx);
    }))
  })
}

Wallet.prototype._parseTx = function parseTx(tx) {
  var id = tx.getId();
  var wallet = this._wallet;
  var metadata = wallet.txMetadata[id];
  var network = bitcoin.networks[wallet.networkName];

  var timestamp = metadata.timestamp;
  timestamp = timestamp ? timestamp * 1000 : new Date().getTime();

  var node = wallet.txGraph.findNodeById(id);
  var prevOutputs = node.prevNodes.reduce(function(inputs, n) {
    inputs[n.id] = n.tx.outs;
    return inputs;
  }, {})

  var inputs = tx.ins.map(function(input) {
    var buffer = new Buffer(input.hash);
    Array.prototype.reverse.call(buffer);
    var inputTxId = buffer.toString('hex');

    return prevOutputs[inputTxId][input.index];
  })

  return {
    id: id,
    amount: metadata.value,
    timestamp: timestamp,
    confirmations: metadata.confirmations,
    fee: metadata.fee,
    ins: parseOutputs(inputs, network),
    outs: parseOutputs(tx.outs, network)
  }
}

function parseOutputs(outputs, network) {
  return outputs.map(function(output){
    return {
      address: bitcoin.Address.fromOutputScript(output.script, network).toString(),
      amount: output.value
    }
  })
}

function requireOption(options, option) {
  if (!(option in options)) throw new Error('Missing required option: ' + option);

  return options[option];
}

function generateMnemonic() {
  return BIP39.entropyToMnemonic(
    rng(128 / 8).toString('hex')
  );
}