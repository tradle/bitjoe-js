'use strict';

var Q = require('q');
var EventEmitter = require('events').EventEmitter;
var common = require('./lib/common');
var MIN_BALANCE = 1e5;
var bitcoin = require('bitcoinjs-lib');
var cryptoUtils = require('./lib/crypto');
var CBWallet = require('cb-wallet');
var BIP39 = require('bip39');
var EventEmitter = require('events').EventEmitter;
var inherits = require('util').inherits;
var fs = require('fs');
var requests = require('./lib/requests');
var extend = require('extend');
var defaults = require('defaults');
var commonBlockchains = require('./lib/commonBlockchains');
var KeeperAPI = require('bitkeeper-client-js');
var debug = require('debug')('bitjoe');
var Jobs = require('simple-jobs');
var path = require('path');
var utils = require('tradle-utils');
var DataLoader = require('./lib/dataLoader');
var reemit = require('re-emitter');
var requireOption = utils.requireOption;
var requireParam = utils.requireParam;
var Charger = require('testnet-charger');
var STABLE_AFTER = 10; // confirmations

var faucets = {
  TP: 'msj42CCGruhRsFrGATiUuh25dtxYtnpbTx',
  Mojocoin: 'mkTXKrJn5nAbuUuvGLt6GQGAkbmnWnjoQt'
};

module.exports = BitJoe;

function BitJoe(config) {
  var self = this;

  EventEmitter.call(this);

  utils.bindPrototypeFunctions(this);

  this._plugins = Object.create(null);
  this._config = config || {};
  var keeper = this.config('keeper');
  this._keeper = keeper.isKeeper ? keeper : new KeeperAPI(keeper);

  this._jobs = new Jobs();

  // this._promptPassword(function() {
  this._loadWallet()
    .then(function() {
      self._walletReady = true;
      self._wallet.on('tx', self._onTransaction);
      self._checkReady();
    })
    .catch(this.exitIfErr);
  // });

  this.on('ready', this._onready);
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

  this._loader = new DataLoader(this.requestConfig());
  reemit(this._loader, this, [
    'file', 'file:public', 'file:shared', 'file:permission', 'permissions:downloaded', 'files:downloaded'
  ]);

  this.on('file', this.processIncomingFile);

  // test mode
  console.log('Balance: ' + this.getBalance());
  console.log('Fund me at ' + this.currentReceiveAddress());
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
  var autofund = this.config('autofund');
  this._wallet = wallet;

  utils.proxyFunctions(this, this._wallet);

  this.scheduleSync();
  if (wallet._isNew) {
    this.emit('newwallet', wallet);
    if (!autofund) return Q.resolve();
  }

  return this.sync()
    .then(function() {
      if (autofund && self.isTestnet() && self.getBalance(0) < MIN_BALANCE) {
        return self.getFunded(typeof autofund === 'number' ? autofund : MIN_BALANCE);
      }
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

BitJoe.prototype.plugin = function(type, plugin) {
  var self = this;

  if (arguments.length === 1) {
    var types = plugin.types;
    if (!types) throw new Error('Specify parameter "type" or define a "types" property on the plugin');

    types.forEach(function(type) {
      self.plugin(type, plugin);
    });
  }

  var plugins = this._plugins[type] = this._plugins[type] || [];
  plugins.push(plugin);
}

BitJoe.prototype.unregister = function(type, plugin) {
  if (arguments.length === 0) {
    // remove all
    this._plugins = {};
    return;
  }

  var plugins = this._plugins[type];
  if (plugins) {
    if (!plugin) {
      // remove all plugins for type
      delete this._plugins[type];
      return;
    }

    var idx = plugins.indexOf(plugin);
    if (idx !== -1) {
      plugins.splice(idx, 1);
      return;
    }
  }

  return false;
}

BitJoe.prototype.getPluginsFor = function(type) {
  var catchAllPlugins = this._plugins['*'] || [];
  var plugins = this._plugins[type] || [];
  return plugins.concat(catchAllPlugins);
}

BitJoe.prototype.processFile = function(obj, incoming) {
  if (!obj._type) return Q.resolve(obj);

  var plugins = this.getPluginsFor(obj._type);
  var processMethod = incoming ? 'processIncoming' : 'processOutgoing';
  // hand off to plugins in series
  return plugins.reduce(function(prev, next) {
      // wrap in promise so we don't have to repeat ourselves below
      // Q.resolve(prev) === prev if prev is a promise
      prev = Q.resolve(prev);
      return prev.then(function(processed) {
        return next[processMethod](processed || obj);
      });
    }, Q.resolve(obj))
    .then(function(processed) {
      return processed || obj;
    });
}

BitJoe.prototype.processIncomingFile = function(obj) {
  return this.processFile(obj, true);
}

BitJoe.prototype.processOutgoingFile = function(obj) {
  return this.processFile(obj);
}

/**
 *  Proxy function to create a new TransactionRequest
 */
BitJoe.prototype.create =
BitJoe.prototype.transaction = function() {
  return new requests.TransactionRequest(this.requestConfig());
}

BitJoe.prototype.share = function() {
  return new requests.ShareRequest(this.requestConfig());
}

BitJoe.prototype.requestConfig = function() {
  return {
    joe: this,
    wallet: this.wallet(),
    networkName: this.networkName(),
    keeper: this.keeper(),
    prefix: this.config('prefix'),
    minConf: this.config('minConf')
  }
}

BitJoe.prototype.wallet = function() {
  return this._wallet;
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
    // self._wallet.on('sync', save);
    self._wallet.on('usedaddress', save);
    self._wallet.on('tx', function(tx) {
      if (!self._isStable(tx)) {
        save();
      }
    });

    // self.on('permission:downloaded', self.loadFile);
  });

  function save() {
    self.queueSave(options);
  }
}

BitJoe.prototype._isStable = function(tx) {
  var md = this._wallet.getMetadata(tx);
  return md && typeof md.confirmations === 'number' && md.confirmations > STABLE_AFTER;
}

BitJoe.prototype._onTransaction = function(tx) {
  debug('Received transaction', tx.getId(), JSON.stringify(this.getMetadata(tx.getId())));
  debug('Balance (confirmed): ' + this.getBalance(6));
  debug('Balance (unconfirmed): ' + this.getBalance(0));

  if (!this._isStable(tx)) {
    this._loader.load(tx);
  }
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

BitJoe.prototype.getFunded = function(amount) {
  amount = amount || MIN_BALANCE;
  var defer = Q.defer();
  var interval;

  this.once('balance', defer.resolve);
  this.charge(10, MIN_BALANCE)
    .then(function() {
      debug('Funding is on its way...');
      interval = setInterval(function() {
        debug('Waiting for funds to arrive...');
      }, 10000);
    })
    .catch(defer.reject);

  return defer.promise.finally(function() {
    clearInterval(interval);
  });
}

BitJoe.prototype.withdrawFromFaucet = function(amount) {
  return this.charge(1, amount);
}

/**
 * @param n - number of addresses to charge
 * @param perAddr - amount to charge each address
 */
BitJoe.prototype.charge = function(n, perAddr) {
  if (!this.isTestnet()) return Q.reject(new Error('can only withdraw from faucet on testnet'));

  var wallet = this._wallet;
  var c = new Charger(wallet);

  for (var i = 0; i < n; i++) {
    c.charge(wallet.getNextAddress(i + 1), perAddr);
  }

  return Q.ninvoke(c, 'execute');
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
  var minConf = this.config('minConf') || 0;
  var oldBalance = this.getBalance(minConf);
  return Q.ninvoke(this._wallet, 'sync')
    .then(function(numUpdates) {
      if (!numUpdates) return;

      self.emit('sync');
      var balance = self.getBalance(minConf);
      if (balance !== oldBalance) {
        self.emit('balance', balance);
      }
    });
}

BitJoe.prototype.exitIfErr = function(err) {
  if (err) {
    console.log('Error', err);
    console.log(err.stack);
    this.destroy().done(function() {
      process.exit();
    });
  }
}

BitJoe.prototype.destroy = function() {
  this._jobs.clear();
  this._savesQueued.length = 0;

  var tasks = [
    // TODO add current save task
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

function loadOrCreateWallet(options) {
  requireParam(options, 'options');

  var walletPath = options.path;
  if (!walletPath) return newWallet(options);

  walletPath = path.resolve(walletPath);
  var password = options.password;

  return Q.ninvoke(fs, 'readFile', walletPath, getFileOptions(options))
    .then(function(file) {
      var json = password ? cryptoUtils.decrypt(file, password) : file;
      return common.walletFromJSON(json);
    })
    .catch(function(err) {
      if (err.status === 'ENOENT') throw err;

      console.log('Existing wallet not found at specified path, creating a new wallet');
      return newWallet(options);
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
