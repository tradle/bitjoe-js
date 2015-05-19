'use strict';

var Q = require('q');
var EventEmitter = require('events').EventEmitter;
var common = require('./lib/common');
var MIN_BALANCE = 1e5;
var bitcoin = require('bitcoinjs-lib');
var CBWallet = require('cb-wallet');
// override CBWallet.API
CBWallet.API = require('cb-blockr');
var BIP39 = require('bip39');
var EventEmitter = require('events').EventEmitter;
var inherits = require('util').inherits;
var requests = require('./lib/requests');
var extend = require('extend');
var commonBlockchains = require('./lib/commonBlockchains');
var KeeperAPI = require('bitkeeper-client-js');
var debug = require('debug')('bitjoe');
var path = require('path');
var utils = require('tradle-utils');
var levelup = require('levelup');
var DataLoader = require('chainloader')
var reemit = require('re-emitter');
var typeforce = require('typeforce')
var Charger = require('testnet-charger');
var cryptoUtils = require('./lib/crypto');
var STABLE_AFTER = 10; // confirmations
var levelOptions = {
  valueEncoding: 'json'
};

var faucets = {
  TP: 'msj42CCGruhRsFrGATiUuh25dtxYtnpbTx',
  Mojocoin: 'mkTXKrJn5nAbuUuvGLt6GQGAkbmnWnjoQt'
};

module.exports = BitJoe;

function BitJoe(config) {
  var self = this;

  typeforce({
    leveldown: 'Function'
  }, config)

  EventEmitter.call(this);

  utils.bindPrototypeFunctions(this);

  this._plugins = Object.create(null);
  this._config = extend({}, config || {});
  var keeper = this.config('keeper');
  this._keeper = keeper.isKeeper ? keeper : new KeeperAPI(keeper);

  // this._promptPassword(function() {
  this._dbs = {};
  this._loadWallet()
    .then(function() {
      self._walletReady = true;
      self.emit('walletready');
      self._wallet.on('tx', self._onTransaction);
      self._checkReady();
    })
    .catch(this.exitIfErr);
  // });

  this.on('ready', this._onready);
  this._syncPromise = null;
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
  var addresses = this._wallet.getAddresses();
  if (addresses.length < 5) {
    addresses = [];
    for (var i = 0; i < 5; i++) {
      addresses.push(this._wallet.getNextAddress(i));
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
  if (this._wallet) return Q.resolve();

  var options = extend({
    networkName: this.networkName()
  }, this.config('wallet'));

  return this._loadOrCreateWallet(options)
    .then(this._initWallet);
}

BitJoe.prototype._initWallet = function(wallet) {
  if (this._wallet) throw new Error('already bound to a wallet');

  var self = this;
  var autofund = this.config('autofund');
  this._wallet = wallet;

  this.scheduleSync();
  if (wallet._isNew) {
    this.emit('newwallet');
    if (!autofund) return Q.resolve();
  }

  return this.sync()
    .then(function() {
      if (autofund && self.isTestnet() && self.getBalance(0) < MIN_BALANCE) {
        var amount = typeof autofund === 'number' ? autofund : MIN_BALANCE;
        var n = 5;
        var perAddr = Math.ceil(amount / n);
        // don't wait for charge to go through
        self.charge(n, perAddr);
      }
    });
}

BitJoe.prototype.identity = function(identity) {
  if (identity) {
    var networkName = this.networkName();
    this._identity = identity;
    this._keys = this._identity.keys('bitcoin').filter(function(key) {
      return key.get('networkName') === networkName;
    });

    this._fromAddresses = this._keys.map(function(key) {
      return key.fingerprint();
    })

    if (this._addressBook) this._addressBook.add(identity, true); // replace
  }

  else return this._identity;
}

BitJoe.prototype.addressBook = function(addressBook) {
  if (addressBook) {
    this._addressBook = addressBook;
    if (this._identity) this._addressBook.add(this._identity, true); // replace
  }
  else return this._addressBook;
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
  var conf = common.pick(this._config, 'prefix', 'minConf', 'addressBook', 'networkName');
  conf.joe = this;
  conf.addressBook = this._addressBook;
  if (this._identity) {
    conf.identity = this._identity;
    conf.fromAddresses = this._fromAddresses;
  }

  conf.keeper = this._keeper;
  conf.wallet = this._wallet;
  return conf;
}

BitJoe.prototype.wallet = function() {
  return this._wallet;
}

BitJoe.prototype.config = function(configOption) {
  return typeof configOption === 'undefined' ? this._config : this._config[configOption];
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
  if (this.ready()) return;

  var storageConfig = this.config('wallet');
  if (storageConfig.autosave) this.autosave(storageConfig.path);
}

BitJoe.prototype.autosave = function(path) {
  typeforce('String', path);

  var self = this;

  if (!this._autosavePaths) this._autosavePaths = [];
  else if (this._autosavePaths.indexOf(path) !== -1) return;

  this._autosavePaths.push(path);
  var options = extend({}, this.config('wallet'), { path: path });

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
    self.save(options);
  }
}

BitJoe.prototype._isStable = function(tx) {
  var md = this.getMetadata(tx);
  return md && typeof md.confirmations === 'number' && md.confirmations > STABLE_AFTER;
}

BitJoe.prototype._onTransaction = function(tx) {
  var metadata = this.getMetadata(tx);
  debug('Received transaction', tx.getId(), common.prettify(metadata));
  debug('Balance (confirmed): ' + this.getBalance(6));
  debug('Balance (unconfirmed): ' + this.getBalance(0));

  var event = 'tx:' + (metadata.confirmations ? 'confirmation' : 'unconfirmed');
  this.emit(event, tx, metadata);

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

  if (this._identity) {
    var from = this._fromAddresses;
    n = Math.min(n, from.length);
    while (n--) {
      c.charge(from[n], perAddr);
    }
  }
  else {
    for (var i = 0; i < n; i++) {
      c.charge(wallet.getNextAddress(i + 1), perAddr);
    }
  }

  return Q.ninvoke(c, 'execute');
}

BitJoe.prototype.getBalance = function(minConf) {
  var self = this;

  minConf = typeof minConf === 'undefined' ? this.config('minConf') : minConf;
  if (!this._identity) return this._wallet.getBalance(minConf);

  return this._wallet.getUnspents(minConf)
    .reduce(function(memo, u) {
      if (self._fromAddresses.indexOf(u.address) !== -1) memo += u.value;

      return memo;
    }, 0);
}

BitJoe.prototype.getTx = function(txId) {
  return this._wallet.getTx(txId);
}

BitJoe.prototype.getNextAddress = function(type, offset) {
  return this._wallet.getNextAddress(type, offset);
}

BitJoe.prototype.getPublicKeyForAddress = function(addr) {
  return this._wallet.getPublicKeyForAddress(addr);
}

/**
 * get metadata (confirmations, value, fee, etc.) for a transaction in the wallet
 * @param {String} txId
 */
BitJoe.prototype.getMetadata =
BitJoe.prototype.getTxMetadata = function(txId) {
  return this._wallet.getMetadata(txId);
}

/**
 * @return Q.Promise for the amount refunded
 */
BitJoe.prototype.refundToFaucet = function(value) {
  if (!this.isTestnet())
    return Q.reject(new Error('Can only return testnet coins'));

  var network = bitcoin.networks[this.networkName()];
  var tx;
  try {
    tx = this._wallet.createTx(faucets.TP, network.dustThreshold + 1, 0, 0);
  } catch (err) {
    return Q.reject(err);
  }

  var maxRefund = this.getBalance() - network.estimateFee(tx);
  value = value || maxRefund;

  if (maxRefund <= 0 || value < maxRefund)
    return Q.reject(new Error('Insufficient funds'));

  try {
    tx = this._wallet.createTx(faucets.TP, value, 0, 0);
  } catch (err) {
    return Q.reject(err);
  }

  return Q.ninvoke(this._wallet, 'sendTx', tx)
    .then(function() {
      return value;
    });
}

BitJoe.prototype.isTestnet = function() {
  return this.networkName() === 'testnet';
}

BitJoe.prototype.toJSON = function() {
  return this._wallet.toJSON();
}

BitJoe.prototype.scheduleSync = function(interval) {
  if (this._destroyed) return;

  interval = interval || this.config('syncInterval') || 60000;

  clearTimeout(this._syncTimeout);
  delete this._syncTimeout;
  this._syncTimeout = setTimeout(this.sync, interval);
}

BitJoe.prototype.sync = function() {
  var self = this;

  if (this._destroyed) return Q.reject();

  if (this._syncPromise) {
    var state = this._syncPromise.inspect().state;
    if (state === 'pending') return this._syncPromise;
  }

  debug('Starting sync');
  this._syncPromise = Q.ninvoke(this._wallet, 'sync')
    .then(function(numUpdates) {
      if (!numUpdates) return;

      self.emit('sync');
    })
    .finally(function() {
      delete self._syncPromise;
      debug('Scheduling next sync');
      self.scheduleSync();
    });

  return this._syncPromise;
}

BitJoe.prototype.exitIfErr = function(err) {
  if (err) {
    console.log('Error', err);
    console.log(err.stack);
    this.destroy().finally(function() {
      process.exit();
    });
  }
}

BitJoe.prototype.destroy = function() {
  if (this._destroyed) return;

  var tasks = [];
  for (var path in this._dbs) {
    tasks.push(Q.ninvoke(this._db(path), 'close'));
  }

  clearTimeout(this._syncTimeout);
  delete this._syncTimeout;
  this._destroyed = true;

  return Q.allSettled(tasks)
    .then(function() {
      debug('I was successfully destroyed');
    })
    .catch(function(err) {
      debug('destroy failed', err);
    });
}

BitJoe.prototype.save = function(options) {
  var self = this;
  options = extend({}, this.config('wallet'), options || {});

  typeforce({
    path: 'String'
  }, options)

  var walletPath = path.resolve(options.path);

  debug('Saving wallet');

  var walletStr = this._wallet.serialize();
  if (options.password) {
    walletStr = utils.encrypt(walletStr, options.password);
  }

  return Q.ninvoke(this._db(walletPath), 'put', 'wallet', walletStr)
    .then(function() {
      debug('Saved wallet');
      self.emit('save');
    })
    .catch(function(err) {
      debug('Failed to save wallet', err);
      self.emit('save:error', err);
    });
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
  if (this._identity) return this._fromAddresses[0];

  return this._wallet.getReceiveAddress();
}

BitJoe.prototype._db = function(path) {
  var opts = extend({ db: this.config('leveldown') }, levelOptions)
  this._dbs[path] = this._dbs[path] || levelup(path, opts);
  return this._dbs[path]
}

BitJoe.prototype._loadOrCreateWallet = function(options) {
  typeforce('Object', options);

  var walletPath = options.path;
  if (!walletPath) return newWallet(options);

  walletPath = path.resolve(walletPath);
  var password = options.password;

  return Q.ninvoke(this._db(walletPath), 'get', 'wallet')
    .then(function(file) {
      if (password) {
        file = utils.decrypt(file, password);
      }

      var wallet = common.walletFromJSON(file);
      console.log('Found existing wallet');
      return wallet;
    })
    .catch(function(err) {
      if (err.name !== 'NotFoundError') throw err;

      console.log('Existing wallet not found at specified path, creating a new wallet');
      return newWallet(options);
    });
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
