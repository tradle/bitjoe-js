
'use strict';

var bitcoin = require('bitcoinjs-lib');
var assert = require('assert');
var cryptoUtils = require('../crypto');
var _ = require('lodash');
var async = require('async');
var common = require('../common');
var cryptoUtils = require('../crypto');
var CBWallet = require('cb-wallet');
// var bip32Wallet = require('bip32-wallet');
var BIP39 = require('bip39');
// var BIP38 = require('bip38');
var EventEmitter = require('events').EventEmitter;
var inherits = require('util').inherits;
var fs = require('fs');
var extend = require('extend');
var cryptoUtils = require('../crypto');
// var discovery = require('../discovery');
var defaults = require('defaults');
var requireOption = common.requireOption;
var requireOptions = common.requireOptions;
// var parallel = require('async').parallel;
var commonBlockchains = require('../commonBlockchains');
var noop = function() {};
var log = console.log.bind(console);
var faucets = {
  TP: 'msj42CCGruhRsFrGATiUuh25dtxYtnpbTx',
  Mojocoin: 'mkTXKrJn5nAbuUuvGLt6GQGAkbmnWnjoQt'
};

// var CONFIRMED_DEPTH = 6;
// var logIfError = function(err) { if (err) console.log(err); };

// var path = require('path');

function WalletAppKit(options) {
  var self = this;

  EventEmitter.call(this);
  _.bindAll(this, 'queueSave', '_save', 'sync');

  requireOptions(options, 'path', 'networkName');

  this._options = options;
  this._setupSaveQueue();
  if (options.autosave)
    this.autosave(options.path);

  this._blockchain = commonBlockchains(this.getOption('networkName'));
  if (this._wallet) {
    return process.nextTick(function() {
      self.emit('ready');
    });
  }

  WalletAppKit.loadOrCreate(this._options, function(err, wallet, created) {
    if (err) return self.emit('error', err);

    self._wallet = wallet;
    common.proxyFunctions(self, self._wallet);

    self.scheduleSync();
    self.sync(function() {
      self.emit('ready');
    });
  });
}

inherits(WalletAppKit, EventEmitter);

WalletAppKit.prototype._setupSaveQueue = function() {
  var self = this;

  this._saveQueue = async.queue(this._save, 1);
  this._saveQueue.drain = function(err) { 
    if (err) return log(err);

    log('Saved wallet');
    log('Current balance ' + self.getBalance());
  }
}

WalletAppKit.prototype.autosave = function(path) {
  var self = this;

  path = path || this.getOption('path');
  assert(path);

  if (!this._autosavePaths)
    this._autosavePaths = [];
  else {
    if (this._autosavePaths.indexOf(path) !== -1) return;

    this._autosavePaths.push(path);
  }

  var options = defaults({ path: path }, this._options);
  var save = this.queueSave.bind(this, options);

  this.on('sync', save);
  this.on('ready', function() {
    self._wallet.on('address:new', save);
    self._wallet.on('transaction:processed', save);
  })

  // this.on('sync:addresses', save);
  // this.on('sync:transactions', save);
  // this.on('sync:unspents', save);
}

WalletAppKit.prototype.withdrawFromFaucet = function(value, callback) {
  var self = this;

  callback = common.asyncify(callback || noop);

  if (!this.isTestnet()) return callback(new Error('can only withdraw from faucet on testnet'));

  commonBlockchains('testnet').addresses.__faucetWithdraw(this.currentReceiveAddress(), value || 1e7, function(err) {
    if (err) return callback(err);

    self.sync(callback);
  });
}

WalletAppKit.prototype.refundToFaucet = function(value, callback) {
  var network = bitcoin.networks[this.networkName()];
  var tx = this._wallet.createTx(faucets.TP, network.dustThreshold + 1, 0, 0);
  var maxRefund = this.getBalance() - network.estimateFee(tx);

  callback = common.asyncify(callback || noop);
  if (maxRefund <= 0) return callback(new Error('Insufficient funds'));

  if (typeof value === 'function') {
    callback = value;
    value = maxRefund;
  }

  value = value || maxRefund;

  if (!this.isTestnet()) return callback(new Error('Can only return testnet coins'));

  if (value > maxRefund) return callback(new Error('Can refund at most ' + maxRefund));

  tx = this._wallet.createTx(faucets.TP, value, 0, 0);
  this._wallet.sendTx(tx, function(err) {
    if (err) return callback(err);

    callback(null, value);
  });
}

WalletAppKit.prototype.isTestnet = function() {
  return this.networkName() === 'testnet';
};

// WalletAppKit.prototype.toJSON = function() {
//   var wallet = this._wallet;
//   var json = wallet.toJSON();
//   if (wallet.txs) {
//     json.txs = wallet.txs.map(function(tx) { return tx.toHex() });
//     json.txMetadata = wallet.txMetadata;
//   }

//   return json;
// }

WalletAppKit.prototype.toJSON = function() {
  return this._wallet.serialize();
}

// WalletAppKit.walletFromJSON = function(json) {
//   var wallet = bip32Wallet.fromJSON(json);
//   if (json.txs) {
//     wallet.txs = json.txs.map(function(tx) { return bitcoin.Transaction.fromHex(tx) });
//     wallet.txMetadata = json.txMetadata;
//   }

//   return wallet;
// }

WalletAppKit.walletFromJSON = function(json) {
  return CBWallet.deserialize(json);
}

WalletAppKit.fromJSON = function(json) {
  return new WalletAppKit({
    wallet: WalletAppKit.walletFromJSON(json)
  });
}

WalletAppKit.prototype.scheduleSync = function(interval) {
  this._syncInterval = interval || 60000;
  if (this._syncIntervalId)
    clearInterval(this._syncIntervalId);

  this._syncIntervalId = setInterval(this.sync, this._syncInterval);
}

WalletAppKit.prototype.newWallet = function(options, callback) {
  options = extend({}, this._options, options);
  return WalletAppKit.newWallet(options, callback);
}

WalletAppKit.newWallet = function(options, callback) {
  options = options || {};
  callback = callback || noop;

  var seed = options.seed;
  var networkName = options.networkName;
  if (!seed) {
    var mnemonic = options.mnemonic || cryptoUtils.generateMnemonic();
    if (!BIP39.validateMnemonic(mnemonic))
      throw new Error('Invalid mnemonic');

    seed = BIP39.mnemonicToSeedHex(mnemonic);
  }

  // return bip32Wallet.fromSeedBuffer(new Buffer(seed, 'hex'), bitcoin.networks[networkName]);
  var accounts = cryptoUtils.accountsFromSeed(new Buffer(seed, 'hex'), networkName);
  var wallet = new CBWallet(accounts.externalAccount, accounts.internalAccount, networkName, function(err) {
    callback(err, wallet);
  });
}

// WalletAppKit.prototype.bootstrap = function(options) {
//   var self = this;

//   this.syncAddresses(options, function(err) {
//     if (err) return self.emit('error', err);

//     parallel([
//       self.syncTransactions.bind(self, options),
//       self.syncUnspents.bind(self, options)
//     ], function(err) {
//       if (err) return self.emit('error', err);

//       self.emit('sync');      
//     });
//   })
// }

// WalletAppKit.prototype.syncAddresses = function(options, cb) {
//   var self = this;
//   var wallet = this._wallet;
//   var before = wallet.getAllAddresses().length;

//   cb = cb || noop;
//   options = options || {};
//   new discovery.Addresses()
//                .wallet(wallet)
//                .networkName(this.networkName())
//                .gapLimit(options.gapLimit || 20)
//                .discover(onSynced);

//   function onSynced(err) {
//     if (err) return cb(err);

//     if (wallet.getAllAddresses().length > before)
//       self.emit('sync:addresses');

//     cb();
//   }
// }

WalletAppKit.prototype.sync = function(cb) {
  var self = this;

  cb = cb || noop;
  this._wallet.sync(function(err) {
    if (err) return cb(err);

    self.emit('sync');
    cb();
  });
}

// WalletAppKit.prototype.processTransactions = function(txs, metadata) {
//   var changed = [];
//   for (var i = 0; i < txs.length; i++) {
//     var tx = txs[i];
//     var id = tx.getId();
//     var processed = this.processTransaction(tx, metadata[tx.getId()], true);
//     if (processed)
//       changed.push(id);
//   }

//   if (changed.length)
//     this.emit('sync:transactions', changed);
// }

// WalletAppKit.prototype.processTransaction = function(tx, metadata, silent) {
//   var wallet = this._wallet;

//   var txId = tx.getId();
//   var mStored = wallet.txMetadata[txId];
//   var mUpdate = metadata[txId];
//   if (_.isEqual(mStored, mUpdate))
//     continue;

//   if (mStored) {
//     wallet.txMetadata[txId] = mUpdate;
//     if (mUpdate.confirmations === CONFIRMED_DEPTH)
//       this.updateUnspent(txId, mUpdate.confirmations);

//     if (!silent) 
//       this.emit('sync:transactions', [txId]);

//     return true;
//   }

//   // process tx, update unspents
//   // return saved;
// }

// WalletAppKit.prototype.isUnspent = function(out) {
//   var txs = this._wallet.txs;
//   var address = bitcoin.Address.fromOutputScript(out.script, bitcoin.networks[this.networkName()]);

//   for (var i = 0; i < txs.length; i++) {
//     var ins = txs[i].ins;
//     for (var j = 0; j < ins.length; j++) {
//       if (ins[i].address === address) return false;
//     }
//   }

//   return true;
// }

// WalletAppKit.prototype.updateUnspent = function(txId, confirmations) {
//   var unspents = this._wallet.unspents;

//   for (var i = 0; i < unspents.length; i++) {
//     var unspent = unspents[i];
//     if (unspent.txId === txId)
//       unspent.confirmations = confirmations;
//   }
// }

// WalletAppKit.prototype.getWalletBlockHeight = function(confirmations) {
//   var wallet = this._wallet;
//   var metadata = wallet.txMetadata;
//   var safeHeight = Infinity;
//   var top = 0;

//   for (var id in metadata) {
//     var txMetadata = metadata[id];
//     if (txMetadata.confirmations < confirmations) {
//       safeHeight = Math.min(safeHeight, txMetadata.blockHeight);
//     }

//     top = Math.max(top, txMetadata.blockHeight);
//   }

//   if (safeHeight === Infinity)
//     return top;

//   return safeHeight;
// }

// WalletAppKit.prototype.syncUnspents = function(options, cb) {
//   var self = this;
//   cb = cb || noop;

//   discovery.unspents(this.networkName(), this.getAllAddresses(), function(err, unspents) {
//    if (err) return cb(err);

//    self.setUnspentOutputs(unspents);
//    self.emit('sync:unspents');
//    cb();
//  });
// }

WalletAppKit.prototype.getOption = function(name) {
  return this._options[name];
}

WalletAppKit.loadOrCreate = function(options, callback) {
  assert(options && callback, 'both options and callback are required');

  var path = requireOption(options, 'path');
  var password = options.password;

  fs.readFile(path, function(err, buf) {
    if (err) {
      if (err.status === 'ENOENT') return callback(err);

      log('Existing wallet not found at specified path, creating a new wallet');
      WalletAppKit.newWallet(options, function(err, wallet) {
        callback(err, wallet, true);
      });
    }
    else {
      var json = toWalletJSON(buf, password);
      callback(null, WalletAppKit.walletFromJSON(json));
    }
  });
}

WalletAppKit.prototype.queueSave = function(options) {
  // only queue if we don't have a save queued already
  assert(options, 'options is a required parameter');

  if (!this._saveQueue.length())
    this._saveQueue.push(options);
}

/*
* Adapted from https://github.com/hivewallet/hive-js/blob/master/app/lib/wallet/index.js
*/
WalletAppKit.prototype._save = function(options, callback) {
  var self = this;

  assert(options && callback, 'both options and callback are required');

  var path = requireOption(options, 'path');

  if (options.overwrite === false) {
    fs.exists(path, function(exists) {
      if (exists) return callback(new Error('Wallet file exists, to overwrite specify option: overwrite'));

      options = defaults({ overwrite: true }, options);
      self.queueSave(options, callback);
    })
  }
  else {
    var walletStr = this.toJSON();
    if (options.password)
      walletStr = cryptoUtils.encrypt(walletStr, options.password);

    common.safeWrite({
      path: path, 
      data: walletStr
      // ,
      // encoding: options.password ? cryptoUtils.CIPHERTEXT_ENCODING : cryptoUtils.CLEARTEXT_ENCODING
    }, callback);
  }
}

// WalletAppKit.prototype.sendCoins = function(options, callback) {
//   assert(options);
//   assert(callback);

//   var wallet = this._wallet;
//   var outputs = [{
//     address: requireOption(options, 'toAddress'),
//     value: requireOption(options, 'value')
//   }];

//   var data = options.data;
//   if (data) {
//     outputs.push({
//       address: bitcoin.scripts.nullDataOutput(data),
//       value: 0
//     });
//   }

//   var tx = wallet.createTransaction(outputs, wallet.external, wallet.internal).transaction;
//   var change = this.getChangeOutput(tx);

//   this.sendTransaction(tx, callback);
// }

// WalletAppKit.prototype.getChangeOutput = function(tx) {
//   var outs = tx.outs;
//   var wallet = this._wallet;
//   for (var i = 0 ; i < outs.length; i++) {
//     var out = outs[i];
//     if (wallet.isChangeAddress(out.script))
//       return out;
//   }

//   return null;
// }

WalletAppKit.prototype.networkName = function() {
  return this.getOption('networkName');
}

WalletAppKit.prototype.wallet = function() {
  return this._wallet;
}

WalletAppKit.prototype.currentReceiveAddress = function() {
  return this._wallet.getReceiveAddress();
}

// function parseOutputs(outputs, network) {
//   return outputs.map(function(output){
//     return {
//       address: bitcoin.Address.fromOutputScript(output.script, network).toString(),
//       amount: output.value
//     }
//   })
// }

function toWalletJSON(buf, password) {
  var walletStr;
  if (typeof password === 'undefined')
    walletStr = buf.toString('utf8');
  else
    walletStr = cryptoUtils.decrypt(buf.toString('utf8'), password);

  return walletStr;
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