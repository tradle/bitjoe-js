
'use strict';

var EventEmitter = require('events').EventEmitter;
var common = require('./lib/common');
var MIN_BALANCE = 1e6;
var bitcoin = require('bitcoinjs-lib');
var assert = require('assert');
var cryptoUtils = require('./lib/crypto');
var async = require('async');
var CBWallet = require('cb-wallet');
var BIP39 = require('bip39');
var EventEmitter = require('events').EventEmitter;
var inherits = require('util').inherits;
var fs = require('fs');
var extend = require('extend');
var defaults = require('extend');
var requireOption = common.requireOption;
var commonBlockchains = require('./lib/commonBlockchains');
var TransactionData = require('./lib/transactionData');
var Permission = require('./lib/permission');
var KeeperAPI = require('./lib/keeperAPI');
var pubsub = require('./lib/pubsub');
var noop = function() {};
var log = function() {
  console.log.apply(console, arguments);
}

var faucets = {
  TP: 'msj42CCGruhRsFrGATiUuh25dtxYtnpbTx',
  Mojocoin: 'mkTXKrJn5nAbuUuvGLt6GQGAkbmnWnjoQt'
};

module.exports = BitJoe;

function BitJoe(config) {
  EventEmitter.call(this);
  common.bindPrototypeFunctions(this);

  this._config = config || {};

  // this._promptPassword(function() {  
    this._loadWallet(this._onInitialized);
  // });

  this.on('ready', this._onready);
}

inherits(BitJoe, EventEmitter);

BitJoe.prototype._loadWallet = function(callback) {
  var self = this;

  this._setupStorage();
  this._keeper = new KeeperAPI(this.config('keeperAddresses')[0]);

  this._blockchain = commonBlockchains(this.networkName());
  if (this._wallet) {
    return process.nextTick(function() {
      self.emit('ready');
    });
  }

  var options = extend({ networkName: this.networkName() }, this.config('wallet'));
  loadOrCreateWallet(options, function(err, wallet, created) {
    if (err) return callback(err);

    self._initWallet(wallet, callback);
  });
}

BitJoe.prototype._initWallet = function(wallet, callback) {
  if (this._wallet) throw new Error('already bound to a wallet');

  var self = this;

  this._wallet = wallet;
  common.proxyFunctions(this, this._wallet);

  this.scheduleSync();
  this.sync(function(err) {
    if (err) return callback(err);

    if (!self.isTestnet() || self.getBalance() >= MIN_BALANCE)
      return callback();

    self.withdrawFromFaucet(MIN_BALANCE, function(err) {
      if (err) return callback(err);

      self.sync(callback);
    });
  });
}

BitJoe.prototype._onready = function() { 
  if (this._ready) return;

  this._ready = true;

  var addrConfig = this.config('address');
  log('Running at', addrConfig.host + ':' + addrConfig.port);

  var addresses = this.wallet().addresses;
  if (addresses.length < 5) {
    for (var i = 0; i < 5; i++) this.wallet().getNextAddress();
  }

  addresses = addresses.slice(addresses.length - 5);
  var pubKeys = addresses.map(this.getPublicKeyForAddress);

  log('Pub keys', pubKeys.map(function(p) { return p.toHex() }));
}

BitJoe.prototype._onInitialized = function(err) {
  if (err) {
    log(err);
    return process.exit();
  }

  this.emit('ready');
}

// BitJoe.prototype._promptPassword = function(callback) {
//   var self = this;

//   callback = common.asyncify(callback);
//   if (this.config('wallet').password)
//     return callback();

//   prompt.start();
//   prompt.get([{
//     name: 'password',
//     description: 'Please enter the password for your wallet',
//     required: true,
//     hidden: true
//   }], function (err, result) {
//     self.config('wallet').password = result.password;
//     callback();
//   });
// }

BitJoe.prototype.wallet = function() {
  return this.wallet();
}

BitJoe.prototype.config = function(configOption) {
  return typeof configOption === 'undefined' ? 
      this._config : 
      this._config[configOption];
}

BitJoe.prototype.setConfig = function(option, value) {
  if (arguments.length === 1)
    this._config = option;
  else
    this._config[option] = value;
}

BitJoe.prototype.isTestnet = function() {
  return this.config('networkName') === 'testnet';
}

BitJoe.prototype.isReady = function() {
  return this._ready;
}

BitJoe.prototype._setupStorage = function() {
  if (this._ready) return;

  var self = this;

  var storageConfig = this.config('wallet');
  if (storageConfig.autosave)
    this.autosave(storageConfig.path);

  this._saveQueue = async.queue(this._save, 1);
  this._saveQueue.drain = function(err) { 
    if (err) return log(err);

    log('Saved wallet');
    log('Current balance ' + self.getBalance());
  }
}

BitJoe.prototype.autosave = function(path) {
  assert(path, 'path is required');

  var self = this;

  if (!this._autosavePaths)
    this._autosavePaths = [];
  else {
    if (this._autosavePaths.indexOf(path) !== -1) return;

    this._autosavePaths.push(path);
  }

  var options = defaults({ path: path }, this.config('wallet'));
  var save = this.queueSave.bind(this, options);

  this.on('sync', save);
  this.on('ready', function() {
    self._wallet.on('address:new', save);
    self._wallet.on('transaction:processed', self.fetchPermissions);
    self.on('permission:downloaded', self.loadFile);
    self.on('file:downloaded', self.processFile);
  });
}

BitJoe.prototype.loadFile = function(permission, callback) {
  var self = this;
  var fileKey = permission.fileKeyString();

  callback = callback || noop;

  this.fetchFile(fileKey, function(err, file) {
    if (err)
      return log('Unable to retrieve file indicated in permission', err);

    file = cryptoUtils.fileToBuf(file);
    var decryptionKey = permission.decryptionKeyBuf();
    if (decryptionKey)
      file = cryptoUtils.decrypt(file, decryptionKey).toString();

    try {
      file = JSON.parse(file);
    } catch (err) {
      log('File is not in expected (JSON) format: ' + file);
      return callback(err);
    }

    self.emit('file:downloaded', file);
    callback(null, file);
  });
}

BitJoe.prototype.processFile = function(file) {
  log('Received file:', file);
  pubsub.emit('file', file);
}

BitJoe.prototype.getTransactionData = function(tx) {
  return TransactionData.fromTx(tx, this.config('prefix'));
}

BitJoe.prototype.getPermissionData = function(tx) {
  var self = this;

  var wallet = this._wallet;
  if (typeof tx === 'string')
    tx = wallet.txGraph.findNodeById(tx).tx;

  var txData = this.getTransactionData(tx);
  if (!txData) return;

  var myAddress;
  var myPrivKey;
  var theirPubKey;
  var toMe = this.getSentToMe(tx);
  var fromMe = this.getSentFromMe(tx);
  if (fromMe.length) {
    // can't figure out their public key
    if (toMe.length === tx.outs.length - 1) {
      tx.ins.some(function(input) {
        var addr = self.getAddressFromInput(input);
        myPrivKey = self.getPrivateKeyForAddress(addr);
        return myPrivKey;
      });

      toMe.some(function(out) {
        var addr = bitcoin.Address.fromOutputScript(out.script, self.network()).toString();
        if (!wallet.isChangeAddress(addr)) {
          theirPubKey = wallet.getPublicKeyForAddress(addr);
          return true;
        }
      });
    }
    else
      log('Unable to process transaction data, don\'t know the public key of the receipient');

    // myAddress = self.getAddressFromInput(fromMe[0]);
    // var notToMe = _.difference(tx.outs, toMe);
    // theirAddress = self.getAddressFromOutput(notToMe[0]);
  }
  else {
    myAddress = this.getAddressFromOutput(toMe[0]);
    myPrivKey = this.getPrivateKeyForAddress(myAddress);
    theirPubKey = bitcoin.ECPubKey.fromBuffer(tx.ins[0].script.chunks[1]);
  }

  if (!myPrivKey || !theirPubKey) return;

  var permissionKey = Permission.decryptKey(myPrivKey, theirPubKey, txData.data());
  return {
    myPriv: myPrivKey,
    theirPub: theirPubKey,
    key: cryptoUtils.toHumanReadableString(permissionKey)
  };
}

// TODO: batch in one request
BitJoe.prototype.fetchPermissions = function(txIds, callback) {
  var self = this;

  var tasks = txIds.map(function(txId) {
    return function(cb) {
      self.fetchPermission(txId, cb);
    }
  });

  async.parallel(tasks, callback);
}

/**
 *  @param tx { bitcoin.Transaction || String } transaction or transaction id
 */
BitJoe.prototype.fetchPermission = function(tx, callback) {
  var self = this;
  var permissionData = this.getPermissionData(tx);

  callback = common.asyncify(callback || noop);
  if (!permissionData) return callback();

  this.fetchFile(permissionData.key, function(err, permissionFile) {
    if (err) return callback(err);

    var permission;
    try {
      permission = Permission.decrypt(permissionData.myPriv, permissionData.theirPub, permissionFile);
    } catch (err) {
      return callback(err);
    }
    
    callback(null, permission);

    self.emit('permission:downloaded', permission);
  });
}

BitJoe.prototype.fetchFile = function(key, callback) {
  return this._keeper.get(key, function(err, resp, body) {
    if (err) return callback(err);

    if (resp.statusCode !== 200) return callback(common.httpError(resp.status, 'Failed to retrieve file from keeper'));

    callback(err, body);
  });
}

BitJoe.prototype.keeper = function() {
  return this._keeper;
}

BitJoe.prototype.getDataTransactions = function() {
  return this._wallet.getTransactionHistory()
                     .filter(common.getOpReturnData);
}

BitJoe.prototype.withdrawFromFaucet = function(value, callback) {
  var self = this;

  callback = common.asyncify(callback || noop);

  if (!this.isTestnet()) return callback(new Error('can only withdraw from faucet on testnet'));

  commonBlockchains('testnet').addresses.__faucetWithdraw(this.currentReceiveAddress(), value || 1e7, function(err) {
    if (err) return callback(err);

    self.sync(callback);
  });
}

BitJoe.prototype.getBalance = function(minConf) {
  return this._wallet.getBalance(typeof minConf === 'undefined' ? this.config('minConf') : minConf);
}

BitJoe.prototype.refundToFaucet = function(value, callback) {
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

BitJoe.prototype.isTestnet = function() {
  return this.networkName() === 'testnet';
};

BitJoe.prototype.toJSON = function() {
  return this._wallet.serialize();
}

// BitJoe.fromJSON = function(json) {
//   return new BitJoe({
//     wallet: common.walletFromJSON(json)
//   });
// }

BitJoe.prototype.scheduleSync = function(interval) {
  this._syncInterval = interval || 60000;
  if (this._syncIntervalId)
    clearInterval(this._syncIntervalId);

  this._syncIntervalId = setInterval(this.sync, this._syncInterval);
}

// BitJoe.prototype.newWallet = function(options, callback) {
//   options = extend({}, this._config, options);
//   return newWallet(options, callback);
// }

BitJoe.prototype.sync = function(cb) {
  var self = this;

  cb = cb || noop;
  this._wallet.sync(function(err, numUpdates) {
    if (err) return cb(err);

    if (numUpdates)
      self.emit('sync');
    
    cb();
  });
}

BitJoe.prototype.queueSave = function(options) {
  // only queue if we don't have a save queued already
  assert(options, 'options is a required parameter');

  if (!this._saveQueue.length())
    this._saveQueue.push(options);
}

/*
* Adapted from https://github.com/hivewallet/hive-js/blob/master/app/lib/wallet/index.js
*/
BitJoe.prototype._save = function(options, callback) {
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
      data: walletStr,
      options: getFileOptions(options)
    }, callback);
  }
}

BitJoe.prototype.getSentToMe = function(tx) {
  var self = this;
  var addresses = this.getAllAddresses();

  return tx.outs.filter(function(out) {
    var address = self.getAddressFromOutput(out);
    return addresses.indexOf(address) !== -1;
  });
}

BitJoe.prototype.getSentFromMe = function(tx) {
  var self = this;
  var addresses = this.getAllAddresses();
  
  return tx.ins.filter(function(input) {
    var address = self.getAddressFromInput(input);
    return addresses.indexOf(address) !== -1;
  });
}

BitJoe.prototype.getAddressFromInput = function(input) {
  return common.getAddressFromInput(input, this.network());
}

BitJoe.prototype.getAddressFromOutput = function(out) {
  return common.getAddressFromOutput(out, this.network());
}

BitJoe.prototype.networkName = function() {
  return this.config('networkName');
}

BitJoe.prototype.network = function() {
  return bitcoin.networks[this.networkName()];
}

BitJoe.prototype.wallet = function() {
  return this._wallet;
}

BitJoe.prototype.currentReceiveAddress = function() {
  return this._wallet.getReceiveAddress();
}

function loadOrCreateWallet(options, callback) {
  assert(options && callback, 'both options and callback are required');

  var path = requireOption(options, 'path');
  var password = options.password;

  fs.readFile(path, getFileOptions(options), function(err, file) {
    if (err) {
      if (err.status === 'ENOENT') return callback(err);

      log('Existing wallet not found at specified path, creating a new wallet');
      newWallet(options, function(err, wallet) {
        callback(err, wallet, true);
      });
    }
    else {
      var json = password ? cryptoUtils.decrypt(file, password) : file;
      callback(null, common.walletFromJSON(json));
    }
  });
}

function getFileOptions(options) {
  return { 
    encoding: getFileEncoding(options.password)
  };
}

function getFileEncoding(passwordProtected) {
  return passwordProtected ? 'base64' : 'utf8';
}

function newWallet(options, callback) {
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