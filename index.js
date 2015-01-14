
'use strict';

var Q = require('q');
var EventEmitter = require('events').EventEmitter;
var common = require('./lib/common');
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
var requireOption = common.requireOption;
var commonBlockchains = require('./lib/commonBlockchains');
var TransactionData = require('./lib/transactionData');
var Permission = require('./lib/permission');
var KeeperAPI = require('bitkeeperAPI');
var hooks = require('./lib/hooks');
var debug = require('debug')('bitjoe');
var Jobs = require('simple-jobs');
var noop = function() {};

var faucets = {
  TP: 'msj42CCGruhRsFrGATiUuh25dtxYtnpbTx',
  Mojocoin: 'mkTXKrJn5nAbuUuvGLt6GQGAkbmnWnjoQt'
};

module.exports = BitJoe;

function BitJoe(config) {
  var self = this;

  EventEmitter.call(this);

  common.bindPrototypeFunctions(this);

  this._config = config || {};
  this._keeper = new KeeperAPI(this.config('keeper'));
  this._jobs = new Jobs();
  this._hooks = hooks(this);

  // this._promptPassword(function() {  
  this._loadWallet()
    .then(function() {
      self._walletReady = true;
      self.checkReady();
    })
    .catch(this.exitIfErr);
  // });
  
  this.on('ready', this._onready);
  this.on('file:downloaded', this.processFile);
}

inherits(BitJoe, EventEmitter);

BitJoe.prototype.checkReady = function() {
  if (this._ready) return;
  if (!this._walletReady) return;

  this.emit('ready');
}

BitJoe.prototype._onready = function() {
  if (this._ready) return;

  this._ready = true;

  var addresses = this.wallet().getAddresses();
  if (addresses.length < 5) {
    addresses = [];
    for (var i = 0; i < 5; i++) {
      addresses.push(this.wallet().getNextAddress(i));
    }
  }

  addresses = addresses.slice(addresses.length - 5);
  var pubKeys = addresses.map(this.getPublicKeyForAddress);

  console.log('Send coins to ' + this.currentReceiveAddress());
  console.log('Balance: ' + this.getBalance());
  debug('Pub keys', pubKeys.map(function(p) { return p.toHex() }));
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

  var options = extend({ networkName: this.networkName() }, this.config('wallet'));
  return loadOrCreateWallet(options)
            .then(this._initWallet);
}

BitJoe.prototype._initWallet = function(wallet) {
  if (this._wallet) throw new Error('already bound to a wallet');

  var self = this;
  this._wallet = wallet;

  if (wallet._isNew) this.emit('newwallet', wallet);

  common.proxyFunctions(this, this._wallet);

  this.scheduleSync();
  return this.sync().then(function() {
    if (!self.isTestnet() || self.getBalance() >= MIN_BALANCE) return;

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
  return new TransactionRequest(this);
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

BitJoe.prototype.isReady = function() {
  return this._ready;
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
  var options = defaults({ path: path }, this.config('wallet'));
  this.on('newwallet', save);

  this.on('ready', function() {
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

BitJoe.prototype.isSentByMe = function(tx) {
  return tx.ins.map(this.getAddressFromInput)
               .some(this.getPrivateKeyForAddress);
}

BitJoe.prototype.isSentToMe = function(tx) {
  return tx.outs.map(this.getAddressFromOutput)
                .some(this.getPrivateKeyForAddress);
}

BitJoe.prototype._onTransaction = function(tx) {
  debug('Received transaction', tx.getId(), JSON.stringify(this.getMetadata(tx.getId())));
  debug('Balance (confirmed): ' + this.getBalance(6));
  debug('Balance (unconfirmed): ' + this.getBalance(0));

  tx = this.getTransaction(tx);

  // if (this.isSentByMe(tx)) return;

  // for debugging purposes only
  this.loadData([tx]);
}

BitJoe.prototype.processFile = function(file) {
  debug('Received file:', file);
  // this.emit('file', file);
}

BitJoe.prototype.getTransactionData = function(tx) {
  tx = this.getTransaction(tx);
  return TransactionData.fromTx(tx, this.config('prefix'));
}

/**
 *  Parses data embedded in tx (in OP_RETURN) and attempts to recover 
 *  the necessary ingredients for obtaining the permission file (a.k.a. intermediate file)
 * 
 *  @return {
 *    key: <permission key in storage>
 *    sharedKey: <key to decrypt permission body>
 *  }
 */
BitJoe.prototype.getPermissionData = function(tx, txData) {
  var self = this;

  txData = txData || this.getTransactionData(tx);
  if (!txData) return;

  var wallet = this._wallet;
  var myAddress;
  var myPrivKey;
  var theirPubKey;
  var toMe = this.getSentToMe(tx);
  var fromMe = this.getSentFromMe(tx);
  if (fromMe.length) {
    // can't figure out their public key
    if (toMe.length !== tx.outs.length - 1) {
      debug('Unable to process transaction data, don\'t know the public key of the receipient');
      return;
    }

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

  var sharedKey = cryptoUtils.sharedEncryptionKey(myPrivKey, theirPubKey);
  var permissionKey = cryptoUtils.decrypt(txData.data(), sharedKey);
  return {
    key: cryptoUtils.toHumanReadableString(permissionKey),
    sharedKey: sharedKey
  };
}

/**
 *  Optimized data loading with minimum calls to keeper
 *  @return {Q.Promise} for files related to the passed in transactions/ids
 **/
BitJoe.prototype.loadData = function(txIds) {
  var self = this;

  var txs = txIds.map(this.getTransaction);
  var txData = txs.map(this.getTransactionData);
  var permissionData = txData.map(noop); // fill with undefineds
  var files = permissionData.slice();    // fill with undefineds
  var keys = txData.map(function(txData, idx) {
    if (!txData) return;

    var key, pData;

    switch (txData.type()) {
      case TransactionData.types.PUBLIC:
        key = txData.data();
        break;
      case TransactionData.types.CLEARTEXT_STORE:
      case TransactionData.types.ENCRYPTED_SHARE:
        pData = permissionData[idx] = self.getPermissionData(txIds[idx], txData);
        if (!pData) return;

        key = pData.key;
        break;
    }

    return cryptoUtils.toHumanReadableString(key);
  });

  keys = compact(keys);

  if (!keys.length) return Q.resolve();

  var idxMap = []; // save indices in {files} we have permissions data for
  var permissions;
  return this.fetchFiles(keys)
  .then(function(results) {
    // fetch any files that required a permission file (a.k.a. intermediate file)
    permissions = txData.reduce(function(memo, txData, i) {
      var data = results[i];
      if (typeof data === 'undefined' || data === null) return memo;

      var pData = permissionData[i];
      var decryptionKey;
      switch (txData.type()) {
        case TransactionData.types.PUBLIC: // we already have our file
          files[i] = data;
          return memo;
        case TransactionData.types.ENCRYPTED_SHARE:
          // fall through
          if (typeof pData === 'undefined') return memo;

          decryptionKey = pData.sharedKey;
        case TransactionData.types.CLEARTEXT_STORE:
          idxMap.push(i);
          debug('Permission ciphertext: ' + data);
          var permission;
          try {
            permission = Permission.recover(data, decryptionKey);
          } catch (err) {
            debug('Failed to recover permission file contents from raw data', err);
            return memo;
          }

          memo.push(permission);
          return memo;
        default:
          throw new Error('unsupported type');
      }      
    }, []);

    if (permissions.length) {
      self.emit('permissions:downloaded', permissions);
      var sharedFileKeys = permissions.map(function(p) { 
        return p.fileKeyString() 
      });

      return self.fetchFiles(sharedFileKeys);
    }

    return [];
  }).then(function(sharedFiles) {
    // merge permission-based files into files array
    sharedFiles.forEach(function(file, idx) {
      var permission = permissions[idx];
      var decryptionKey = permission.decryptionKeyBuf();
      if (decryptionKey)
        file = cryptoUtils.decrypt(file, decryptionKey);

      var fileIdx = idxMap[idx];
      files[fileIdx] = file;
    });

    var numFiles = 0;
    var fileInfos = [];
    files.forEach(function(f, i) {
      try {
        files[i] = JSON.parse(f.toString());
        fileInfos.push({
          file: f,
          permission: permissions[i],
          tx: txs[i]
        })

        numFiles++;
      } catch (err) {
        debug('Failed to parse file JSON', err);
        files[i] = null;
      }
    });

    if (numFiles) self.emit('files:downloaded', fileInfos);

    return files;
  });
}

BitJoe.prototype.getTransaction = function(txId) {
  if (txId.ins && txId.outs) return txId;

  var node = this._wallet.txGraph.findNodeById(txId);
  return node && node.tx;
}

BitJoe.prototype.fetchFiles = function(keys) {
  // if (spread) return Q.allSettled(keys.map(this.fetchFiles));

  return Q.ninvoke(this._keeper, 'getMany', keys)
    .catch(function(err) {
      // throw common.httpError(err.code || 400, err.message || 'Failed to retrieve file from keeper');
      throw err;
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
  callback = common.asyncify(callback || noop);

  if (!this.isTestnet()) return callback(new Error('can only withdraw from faucet on testnet'));

  var cbAddresses = commonBlockchains('testnet').addresses;
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
    return Q.reject(common.httpError(500, 'Insufficient funds'));

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
  this._syncInterval = interval || 60000;
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
  var path = requireOption(options, 'path');

  this._saving = true;
  console.log('Saving wallet');

  if (options.overwrite === false) {
    fs.exists(path, function(exists) {
      if (exists) return callback(new Error('Wallet file exists, to overwrite specify option: overwrite'));

      options = defaults({ overwrite: true }, options);
      self.queueSave(options);
      done();
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

/**
 *  @return {Array} outputs in tx that the underlying wallet can spend
 */
BitJoe.prototype.getSentToMe = function(tx) {
  var self = this;

  return tx.outs.filter(function(out) {
    var address = self.getAddressFromOutput(out);
    return self.getPrivateKeyForAddress(address) && out;
  });
}

/**
 *  @return {Array} inputs in tx that are signed by the underlying wallet
 */
BitJoe.prototype.getSentFromMe = function(tx) {
  var self = this;
  
  return tx.ins.filter(function(input) {
    var address = self.getAddressFromInput(input);
    return self.getPrivateKeyForAddress(address) && input;
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

BitJoe.prototype.addHooks = function(url/* [event1, event2, ...] */) {
  return this._hooks.addHooks.apply(this._hooks, arguments);
}

BitJoe.prototype.removeHooks = function(url/* [event1, event2, ...] */) {
  return this._hooks.removeHooks.apply(this._hooks, arguments);
}

function loadOrCreateWallet(options) {
  requireParam(options, 'options');

  var path = requireOption(options, 'path');
  var password = options.password;
  var deferred = Q.defer();

  Q.ninvoke(fs, 'readFile', path, getFileOptions(options))
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
    externalAccount: accounts.externalAccount, 
    internalAccount: accounts.internalAccount, 
    networkName: networkName
  }, function(err) {
    if (err) return deferred.reject(err);

    deferred.resolve(wallet);
  });

  wallet._isNew = true;
  return deferred.promise;
}

function requireParam(paramName, paramValue) {
  if (typeof paramValue === 'undefined') throw new Error('Missing required parameter: ' + paramName);

  return paramValue;
}

function compact(arr) {
  return arr.filter(function(val) {
    return !!val;
  });
}