
'use strict';

var bitcoin = require('bitcoinjs-lib');
var assert = require('assert');
var cryptoUtils = require('../crypto');
var _ = require('lodash');
var async = require('async');
var common = require('../common');
var cryptoUtils = require('../crypto');
// var CBWallet = require('cb-wallet');
var bip32Wallet = require('bip32-wallet');
var BIP39 = require('bip39');
// var BIP38 = require('bip38');
var EventEmitter = require('events').EventEmitter;
var inherits = require('util').inherits;
var fs = require('fs');
var extend = require('extend');
var cryptoUtils = require('../crypto');
var discovery = require('../discovery');
var defaults = require('defaults');
var requireOption = common.requireOption;
var parallel = require('async').parallel;
var commonBlockchains = require('../commonBlockchains');
var noop = function() {};
var log = console.log.bind(console);
var CONFIRMED_DEPTH = 6;
// var logIfError = function(err) { if (err) console.log(err); };

// var path = require('path');

function WalletAppKit(options) {
  EventEmitter.call(this);
  _.bindAll(this, 'queueSave', '_save', 'syncTransactions');

  requireOption(options, 'path');
  requireOption(options, 'networkName');
  if (options.autosave)
    this.autosave(options.path);

  this._options = options;
  this._saveQueue = async.queue(function(task, callback) {
    task(callback);
  }, 1);
}

inherits(WalletAppKit, EventEmitter);

WalletAppKit.prototype.startAsync = function() {
  var self = this;

  this._blockchain = commonBlockchains(this.getOption('networkName'));
  if (this._wallet) {
    return process.nextTick(function() {
      self.emit('ready');
    });
  }

  WalletAppKit.loadOrCreate(this._options, function(err, wallet) {
    if (err) return self.emit('error', err);

    self._wallet = wallet;
    common.proxyFunctions(self, self._wallet);

    self.syncTransactions(null, function() {
      self.emit('ready');
    });
  });

  this.on('ready', function() {
    self.scheduleSync();
  });
}

WalletAppKit.prototype.autosave = function(path) {
  path = path || this.getOption('path');
  assert(path);

  if (!this._autosavePaths)
    this._autosavePaths = [];
  else {
    if (~this._autosavePaths.indexOf(path)) return;

    this._autosavePaths.push(path);
  }

  var options = { path: path };
  var save = this.queueSave.bind(this, options, function(err) { 
    if (err) return console.log(err);

    console.log('Autosaved wallet to ' + path);
  });

  this.on('sync:addresses', save);
  this.on('sync:transactions', save);
  this.on('sync:unspents', save);
}

WalletAppKit.prototype.toJSON = function() {
  var wallet = this._wallet;
  var json = wallet.toJSON();
  if (wallet.txs) {
    json.txs = wallet.txs.map(function(tx) { return tx.toHex() });
    json.txMetadata = wallet.txMetadata;
  }

  return json;
}

WalletAppKit.prototype.scheduleSync = function(interval) {
  this._syncInterval = interval || 60000;
  if (this._syncIntervalId)
    clearInterval(this._syncIntervalId);

  this._syncIntervalId = setInterval(this.syncTransactions, this._syncInterval);
}

WalletAppKit.prototype.newWallet = function(options) {
  options = extend({}, this._options, options);
  return WalletAppKit.newWallet(options);
}

WalletAppKit.newWallet = function(options) {
  options = options || {};

  var seed = options.seed;
  var networkName = options.networkName;
  if (!seed) {
    var mnemonic = options.mnemonic || cryptoUtils.generateMnemonic();
    if (!BIP39.validateMnemonic(mnemonic))
      throw new Error('Invalid mnemonic');

    seed = BIP39.mnemonicToSeedHex(mnemonic);
  }

  return bip32Wallet.fromSeedBuffer(new Buffer(seed, 'hex'), bitcoin.networks[networkName]);
}

WalletAppKit.prototype.bootstrap = function(options) {
  var self = this;

  this.syncAddresses(options, function(err) {
    if (err) return self.emit('error', err);

    parallel([
      self.syncTransactions.bind(self, options),
      self.syncUnspents.bind(self, options)
    ], function(err) {
      if (err) return self.emit('error', err);

      self.emit('sync');      
    });
  })
}

WalletAppKit.prototype.syncAddresses = function(options, cb) {
  var self = this;
  var wallet = this._wallet;
  var before = wallet.getAllAddresses().length;

  cb = cb || noop;
  options = options || {};
  new discovery.Addresses()
               .wallet(wallet)
               .networkName(this.networkName())
               .gapLimit(options.gapLimit || 20)
               .discover(onSynced);

  function onSynced(err) {
    if (err) return cb(err);

    if (wallet.getAllAddresses().length > before)
      self.emit('sync:addresses');

    cb();
  }
}

WalletAppKit.prototype.syncTransactions = function(options, cb) {
  cb = cb || noop;
  options = options || {}; 

  var self = this;
  var wallet = this._wallet;
  var blockHeight = this.getWalletBlockHeight(CONFIRMED_DEPTH);

  wallet.txs = wallet.txs || [];                 
  wallet.txMetadata = wallet.txMetadata || {};

  new discovery.Transactions()
               .networkName(this.networkName())
               .addresses(wallet.getAllAddresses())
               .blockHeight(blockHeight)
               .discover(onSynced);

  function onSynced(err, txs, metadata) {
    if (err) return cb(err);

    var saved = self._saveTransactions(txs, metadata);
    if (saved.length)
      self.emit('sync:transactions', saved);

    cb();
  }
}

WalletAppKit.prototype._saveTransactions = function(txs, metadata) {
  var wallet = this._wallet;
  var saved = [];

  for (var i = 0; i < txs.length; i++) {
    var tx = txs[i];
    var txId = tx.getId();
    var mStored = wallet.txMetadata[txId];
    var mUpdate = metadata[txId];
    if (_.isEqual(mStored, mUpdate))
      continue;

    var idx = _.findIndex(wallet.txs, function(t) { 
      return t.getId() === txId 
    });

    if (idx === -1) 
      idx = wallet.txs.length;

    wallet.txs[idx] = tx;
    wallet.txMetadata[txId] = mUpdate;
    if (mUpdate.confirmations === CONFIRMED_DEPTH)
      this.updateUnspent(txId, mUpdate.confirmations);

    saved.push(txId);
  }

  return saved;
}

WalletAppKit.prototype.updateUnspent = function(txId, confirmations) {
  var unspents = this._wallet.unspents;

  for (var i = 0; i < unspents.length; i++) {
    var unspent = unspents[i];
    if (unspent.txId === txId)
      unspent.confirmations = confirmations;
  }
}

WalletAppKit.prototype.getWalletBlockHeight = function(confirmations) {
  var wallet = this._wallet;
  var metadata = wallet.txMetadata;
  var safeHeight = Infinity;
  var top = 0;

  for (var id in metadata) {
    var txMetadata = metadata[id];
    if (txMetadata.confirmations < confirmations) {
      safeHeight = Math.min(safeHeight, txMetadata.blockHeight);
    }

    top = Math.max(top, txMetadata.blockHeight);
  }

  if (safeHeight === Infinity)
    return top;

  return safeHeight;
}

WalletAppKit.prototype.syncUnspents = function(options, cb) {
  var self = this;
  cb = cb || noop;

  discovery.unspents(this.networkName(), this.getAllAddresses(), function(err, unspents) {
   if (err) return cb(err);

   self.setUnspentOutputs(unspents);
   self.emit('sync:unspents');
   cb();
 });
}

WalletAppKit.prototype.getOption = function(name) {
  return this._options[name];
}

WalletAppKit.loadOrCreate = function(options, callback) {
  assert(options);
  assert(callback);

  var path = requireOption(options, 'path');
  var password = options.password;

  fs.readFile(path, function(err, buf) {
    if (err) {
      if (err.status === 'ENOENT') return callback(err);

      log('Existing wallet not found at specified path, creating a new wallet');
      callback(null, WalletAppKit.newWallet(options));
    }
    else {
      var json = toWalletJSON(buf, password);
      callback(null, WalletAppKit.walletFromJSON(json));
    }
  });
}

WalletAppKit.walletFromJSON = function(json) {
  var wallet = bip32Wallet.fromJSON(json);
  if (json.txs) {
    wallet.txs = json.txs.map(function(tx) { return bitcoin.Transaction.fromHex(tx) });
    wallet.txMetadata = json.txMetadata;
  }

  return wallet;
}

WalletAppKit.fromJSON = function(json) {
  return new WalletAppKit({
    wallet: WalletAppKit.walletFromJSON(json)
  });
}

WalletAppKit.prototype.queueSave = function(options, callback) {
  // only queue if we don't have a save queued already
  var self = this;

  assert(options);
  assert(callback);

  if (!this._saveQueue.length()) {
    this._saveQueue.push(function() {
      self._save(options || self._options, callback || noop);
    });
  }
}

/*
* Adapted from https://github.com/hivewallet/hive-js/blob/master/app/lib/wallet/index.js
*/
WalletAppKit.prototype._save = function(options, callback) {
  var self = this;

  assert(options);
  assert(callback);

  var path = requireOption(options, 'path');

  if (options.overwrite === false) {
    fs.exists(path, function(exists) {
      if (exists) return callback(new Error('Wallet file exists, to overwrite specify option: overwrite'));

      options = defaults({ overwrite: true }, options);
      self.queueSave(options, callback);
    })
  }
  else {
    var walletStr = JSON.stringify(this.toJSON());
    if (options.password)
      walletStr = cryptoUtils.encrypt(walletStr, options.password);

    common.safeWrite(path, walletStr, callback);
  }
}

WalletAppKit.prototype.sendCoins = function(options, callback) {
  assert(options);
  assert(callback);

  var wallet = this._wallet;
  var outputs = [{
    address: requireOption(options, 'toAddress'),
    value: requireOption(options, 'value')
  }];

  var data = options.data;
  if (data) {
    outputs.push({
      address: bitcoin.scripts.nullDataOutput(data),
      value: 0
    });
  }

  var tx = wallet.createTransaction(outputs, wallet.external, wallet.internal).transaction;
  this.sendTransaction(tx, callback);
}

WalletAppKit.prototype.sendTransaction = function(tx, callback) {
  var self = this;

  this._blockchain.transactions.propagate(tx.toHex(), function(err) {
    if (err) return callback(err);

    self._wallet.txs.push(tx);
    self._wallet.txMetadata[tx.getId()] = {
      confirmations: 0
    };

    self.trigger('sync:transactions', [tx.getId()]);
  });
}

WalletAppKit.prototype.networkName = function() {
  return this.getOption('networkName');
}

WalletAppKit.prototype.wallet = function() {
  return this._wallet;
}

function parseOutputs(outputs, network) {
  return outputs.map(function(output){
    return {
      address: bitcoin.Address.fromOutputScript(output.script, network).toString(),
      amount: output.value
    }
  })
}

function toWalletJSON(buf, password) {
  var walletStr;
  if (typeof password === 'undefined')
    walletStr = cryptoUtils.decrypt(buf.toString(cryptoUtils.CIPHERTEXT_ENCODING), password);
  else
    walletStr = buf.toString(cryptoUtils.CLEARTEXT_ENCODING);

  return JSON.parse(walletStr);
}

/**
* convert arguments with zero or more of [options, callback] missing to 
* {
*  options: options or defaultOptions
*  callback: callback or defaultCallback or noop
* }
*/
// function normalizeArguments(args, defaultOptions, defaultCallback) {
//   var normalized = {};
//   switch (args.length) {
//     case 2:
//       normalized.options = args[0];
//       normalized.callback = args[1];
//       break;
//     case 1:
//       if (typeof args[0] === 'function') {
//         callback = args[0];
//         options = defaultOptions || {};
//   }

//   if (args)
//   defaultCallback = defaultCallback || noop;
// }

module.exports = WalletAppKit;