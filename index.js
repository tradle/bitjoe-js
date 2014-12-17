
'use strict';

var prompt = require('prompt');
var path = require('path');
// var commonBlockchains = require('./lib/commonBlockchains');
var EventEmitter = require('events').EventEmitter;
var inherits = require('util').inherits;
var WalletAppKit = require('./lib/walletAppKit');
var log = console.log.bind(console);
var _ = require('lodash');
var common = require('./lib/common');
var MIN_BALANCE = 1e6;
var log = console.log.bind(console);

module.exports = BitJoe;

function BitJoe(config) {
  var self = this;
  var prototypeFns = _.functions(this.prototype);
  prototypeFns.unshift(this);
  _.bindAll.apply(_, prototypeFns);

  EventEmitter.call(this);

  this._config = config || {};
  this.on('error', this._onerror.bind(this));

  this._promptPassword(function() {  
    self._loadWallet(self._onInitialized.bind(self));
  });

  this.on('ready', function() { 
    self._ready = true 
    log('Unspents', JSON.stringify(self._kit.getUnspents(0)));

    var addresses = self.wallet().addresses;
    if (addresses.length < 5) {
      for (var i = 0; i < 5; i++) self.wallet().getNextAddress();
    }

    addresses = addresses.slice(addresses.length - 5);
    var pubKeys = addresses.map(self.kit().getPublicKeyForAddress.bind(self));

    log('Pub keys', pubKeys.map(function(p) { return p.toHex() }));
  });
}

inherits(BitJoe, EventEmitter);

BitJoe.prototype._onerror = function(err) {
  log(err);
}

BitJoe.prototype._loadWallet = function(callback) {
  var self = this;

  var storageConfig = this._config.wallet;
  var walletConfig = _.pick(this.config(), 'allowSpendUnconfirmed', 'networkName');

  walletConfig.password = this.config('wallet').password;
  walletConfig.path = path.join(storageConfig.folder, storageConfig.name + '.wallet');
  walletConfig.autosave = true;

  this._kit = new WalletAppKit(walletConfig);
  // this._kit.startAsync();
  this._kit.on('ready', function() {
    if (self.isTestnet() && self._kit.getBalance() < MIN_BALANCE) {
      self._kit.withdrawFromFaucet(MIN_BALANCE, function(err) {
        if (err) return callback(err);

        self._kit.sync(callback);
      });
    }
    else
      callback();
  });
}

BitJoe.prototype._onInitialized = function(err) {
  if (err) {
    log(err);
    return process.exit();
  }

  this.emit('ready');
}

BitJoe.prototype._promptPassword = function(callback) {
  var self = this;

  callback = common.asyncify(callback);
  if (this.config('wallet').password)
    return callback();

  prompt.start();
  prompt.get([{
    name: 'password',
    description: 'Please enter the password for your wallet',
    required: true,
    hidden: true
  }], function (err, result) {
    self.config('wallet').password = result.password;
    callback();
  });
}

BitJoe.prototype.wallet = function() {
  return this._kit.wallet();
}

BitJoe.prototype.kit = function() {
  return this._kit;
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