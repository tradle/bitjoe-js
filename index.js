'use strict';

var Q = require('q');
var EventEmitter = require('events').EventEmitter;
var common = require('./lib/common');
var dezalgo = require('dezalgo');
var MIN_BALANCE = 1e6;
var bitcoin = require('bitcoinjs-lib');
var cryptoUtils = require('./lib/crypto');
var CBWallet = require('cb-wallet');
var BIP39 = require('bip39');
var EventEmitter = require('events').EventEmitter;
var inherits = require('util').inherits;
var fs = require('fs');
var extend = require('extend');
var TransactionRequest = require('./lib/requests').TransactionRequest;
var defaults = require('extend');
var commonBlockchains = require('./lib/commonBlockchains');
var KeeperAPI = require('bitkeeper-client-js');
var hooks = require('./lib/hooks');
var debug = require('debug')('bitjoe');
var Jobs = require('simple-jobs');
var path = require('path');
var utils = require('tradle-utils');
var DataLoader = require('./lib/dataLoader');
var requireOption = utils.requireOption;
var requireParam = utils.requireParam;
var noop = function() {};

var faucets = {
  TP: 'msj42CCGruhRsFrGATiUuh25dtxYtnpbTx',
  Mojocoin: 'mkTXKrJn5nAbuUuvGLt6GQGAkbmnWnjoQt'
};

module.exports = BitJoe;

function BitJoe(config) {
  var self = this;

  EventEmitter.call(this);

  utils.bindPrototypeFunctions(this);

  this._config = config || {};
  var keeper = this.config('keeper');
  this._keeper = keeper.isKeeper ? keeper : new KeeperAPI(keeper);

  this._jobs = new Jobs();
  this._hooks = hooks(this);

  // this._promptPassword(function() {
  this._loadWallet()
    .then(function() {
      self._walletReady = true;
      self._checkReady();
    })
    .catch(this.exitIfErr);
  // });

  this.on('ready', this._onready);
  this.on('file:downloaded', this.processFile);
}

inherits(BitJoe, EventEmitter);

BitJoe.prototype._checkReady = function() {
  if (this.ready()) return;
  if (!this._walletReady) return;

  this.emit('ready');
}

BitJoe.prototype.ready = function() {
  return this._ready;
}

BitJoe.prototype._onready = function() {
  if (this.ready()) return;

  this._ready = true;

  this._loader = new DataLoader({
    keeper: this.keeper(),
    wallet: this.wallet(),
    networkName: this.networkName(),
    prefix: this.config('prefix')
  })

  // test mode
  console.log('Send coins to ' + this.currentReceiveAddress());
  console.log('Balance: ' + this.getBalance());
  var addresses = this.wallet().getAddresses();
  if (addresses.length < 5) {
    addresses = [];
    for (var i = 0; i < 5; i++) {
      addresses.push(this.wallet().getNextAddress(i));
    }
  }

  addresses = addresses.slice(addresses.length - 5);
  var pubKeys = addresses.map(this.getPublicKeyForAddress);

  debug('Pub keys', pubKeys.map(function(p) {
    return p.toHex()
  }));
}

BitJoe.prototype._loadWallet = function() {
  // var self = this;

  this._setupStorage();

  this._blockchain = commonBlockchains(this.networkName());
  if (this._wallet) {
    // return process.nextTick(function() {
    //   self.emit('ready');
    // });
    return Q.resolve();
  }

  var options = extend({
    networkName: this.networkName()
  }, this.config('wallet'));
  return loadOrCreateWallet(options)
    .then(this._initWallet);
}

BitJoe.prototype._initWallet = function(wallet) {
  if (this._wallet) throw new Error('already bound to a wallet');

  var self = this;
  this._wallet = wallet;

  if (wallet._isNew) this.emit('newwallet', wallet);

  utils.proxyFunctions(this, this._wallet);

  this.scheduleSync();
  return this.sync()
    .then(function() {
      if (!self.isTestnet() || self.getBalance(0) >= MIN_BALANCE) return;

      return self.withdrawFromFaucet(MIN_BALANCE)
        .then(self.sync);
    });
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

/**
 *  Proxy function to create a new TransactionRequest
 */
BitJoe.prototype.transaction = function() {
  return new TransactionRequest({
    wallet: this.wallet(),
    networkName: this.networkName(),
    keeper: this.keeper(),
    prefix: this.config('prefix'),
    minConf: this.config('minConf')
  });
}

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

BitJoe.prototype._setupStorage = function() {
  if (this._ready) return;

  var storageConfig = this.config('wallet');
  if (storageConfig.autosave)
    this.autosave(storageConfig.path);

  // this._saveQueue = queue(1); // prevent concurrent saves
  this._savesQueued = [];
}

BitJoe.prototype.autosave = function(path) {
  requireParam('path', path);

  var self = this;

  if (!this._autosavePaths)
    this._autosavePaths = [];
  else if (this._autosavePaths.indexOf(path) !== -1)
    return;

  this._autosavePaths.push(path);
  var options = defaults({
    path: path
  }, this.config('wallet'));
  this.on('newwallet', save);

  this.on('ready', function() {
    self._wallet.on('sync', save);
    self._wallet.on('usedaddress', save);
    self._wallet.on('transaction:new', save);
    self._wallet.on('transaction:new', self._onTransaction);
    self._wallet.on('transaction:update', save);
    self._wallet.on('transaction:update', self._onTransaction);
    // self.on('permission:downloaded', self.loadFile);
  });

  function save() {
    self.queueSave(options);
  }
}

BitJoe.prototype._onTransaction = function(tx) {
  debug('Received transaction', tx.getId(), JSON.stringify(this.getMetadata(tx.getId())));
  debug('Balance (confirmed): ' + this.getBalance(6));
  debug('Balance (unconfirmed): ' + this.getBalance(0));

  this._loader.load(tx);
}

BitJoe.prototype.processFile = function(file) {
  debug('Received file:', file);
  // this.emit('file', file);
}

BitJoe.prototype.keeper = function() {
  return this._keeper;
}

BitJoe.prototype.loadData = function(txs) {
  return this._loader.load(txs);
}

BitJoe.prototype.getDataTransactions = function() {
  return this._wallet.getTransactionHistory()
    .filter(common.getOpReturnData);
}

BitJoe.prototype.withdrawFromFaucet = function(value, callback) {
  callback = dezalgo(callback || noop);

  if (!this.isTestnet()) return callback(new Error('can only withdraw from faucet on testnet'));

  var cbAddresses = commonBlockchains('testnet').addresses;
  console.log('Withdrawing from testnet faucet');

  return Q.ninvoke(cbAddresses, '__faucetWithdraw', this.currentReceiveAddress(), value || 1e7);
}

BitJoe.prototype.getBalance = function(minConf) {
  return this._wallet.getBalance(typeof minConf === 'undefined' ? this.config('minConf') : minConf);
}

/**
 * @return Q.Promise for the amount refunded
 */
BitJoe.prototype.refundToFaucet = function(value) {
  if (!this.isTestnet())
    return Q.reject(new Error('Can only return testnet coins'));

  var network = bitcoin.networks[this.networkName()];
  var tx = this._wallet.createTx(faucets.TP, network.dustThreshold + 1, 0, 0);
  var maxRefund = this.getBalance() - network.estimateFee(tx);
  value = value || maxRefund;

  if (maxRefund <= 0 || value < maxRefund)
    return Q.reject(new Error('Insufficient funds'));

  tx = this._wallet.createTx(faucets.TP, value, 0, 0);
  return Q.ninvoke(this._wallet, 'sendTx', tx)
    .then(function() {
      return value;
    });
}

BitJoe.prototype.isTestnet = function() {
  return this.networkName() === 'testnet';
}

BitJoe.prototype.toJSON = function() {
  return this._wallet.serialize();
}

BitJoe.prototype.scheduleSync = function(interval) {
  this._syncInterval = interval || this.config('syncInterval') || 60000;
  if (!this._jobs.has('sync'))
    this._jobs.add('sync', this.sync, this._syncInterval);
}

BitJoe.prototype.sync = function() {
  var self = this;
  return Q.ninvoke(this._wallet, 'sync')
    .then(function(numUpdates) {
      if (numUpdates) self.emit('sync');
    });
}

BitJoe.prototype.exitIfErr = function(err) {
  if (err) {
    console.log('Error', err);
    this.destroy().done(function() {
      process.exit();
    });
  }
}

BitJoe.prototype.destroy = function() {
  this._jobs.clear();
  this._savesQueued.length = 0;
  // TODO add current save task

  var tasks = [
    // Q.ninvoke(this._server, 'close')
  ];

  return Q.all(tasks);
}

BitJoe.prototype.queueSave = function(options, callback) {
  requireParam('options', options);

  if (this._savesQueued.length) return;
  if (this._saving) {
    this._savesQueued.push(arguments);
    debug('Queued save');
    return;
  }

  this._save(options);
}

BitJoe.prototype._save = function(options, callback) {
  var self = this;

  requireParam('options', options);
  var walletPath = requireOption(options, 'path');
  walletPath = path.resolve(walletPath);

  this._saving = true;
  console.log('Saving wallet');

  if (options.overwrite === false) {
    fs.exists(walletPath, function(exists) {
      if (exists) return callback(new Error('Wallet file exists, to overwrite specify option: overwrite'));

      options = defaults({
        overwrite: true
      }, options);
      self.queueSave(options);
      done();
    })
  } else {
    var walletStr = this.toJSON();
    if (options.password)
      walletStr = cryptoUtils.encrypt(walletStr, options.password);

    utils.writeFile({
      // safe: false,
      path: walletPath,
      data: walletStr,
      options: getFileOptions(options)
    }, done);
  }

  function done(err) {
    console.log('Saved wallet');
    self._saving = false;

    if (callback)
      callback(err);

    if (self._savesQueued.length)
      self._save.apply(self, self._savesQueued.pop());
  }
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

BitJoe.prototype.addHooks = function(url /* [event1, event2, ...] */ ) {
  return this._hooks.addHooks.apply(this._hooks, arguments);
}

BitJoe.prototype.removeHooks = function(url /* [event1, event2, ...] */ ) {
  return this._hooks.removeHooks.apply(this._hooks, arguments);
}

function loadOrCreateWallet(options) {
  requireParam(options, 'options');

  var walletPath = requireOption(options, 'path');
  walletPath = path.resolve(walletPath);
  var password = options.password;
  var deferred = Q.defer();

  Q.ninvoke(fs, 'readFile', walletPath, getFileOptions(options))
    .then(function(file) {
      var json = password ? cryptoUtils.decrypt(file, password) : file;
      deferred.resolve(common.walletFromJSON(json));
    })
    .catch(function(err) {
      if (err.status === 'ENOENT') throw err;

      console.log('Existing wallet not found at specified path, creating a new wallet');
      newWallet(options)
        .then(deferred.resolve)
        .catch(deferred.reject);
    })
    .done();

  return deferred.promise;
}

function getFileOptions(options) {
  return {
    encoding: getFileEncoding(options.password)
  };
}

function getFileEncoding(passwordProtected) {
  return passwordProtected ? 'base64' : 'utf8';
}

function newWallet(options) {
  options = options || {};

  var seed = options.seed;
  var networkName = options.networkName;
  if (!seed) {
    var mnemonic = options.mnemonic || cryptoUtils.generateMnemonic();
    if (!BIP39.validateMnemonic(mnemonic))
      throw new Error('Invalid mnemonic');

    seed = BIP39.mnemonicToSeedHex(mnemonic);
  }

  // return bip32Wallet.fromSeedBuffer(new Buffer(seed, 'hex'), bitcoin.networks[networkName]);
  var deferred = Q.defer();
  var accounts = cryptoUtils.accountsFromSeed(new Buffer(seed, 'hex'), networkName);
  var wallet = new CBWallet({
    externalAccount: accounts.external,
    internalAccount: accounts.internal,
    networkName: networkName
  }, function(err) {
    if (err) return deferred.reject(err);

    deferred.resolve(wallet);
  });

  wallet._isNew = true;
  return deferred.promise;
}
