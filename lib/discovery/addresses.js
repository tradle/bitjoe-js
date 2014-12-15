
'use strict';

var commonBlockchains = require('../commonBlockchains');
var discover = require('bip32-utils').discovery
var parallel = require('async').parallel;

function AddressDiscovery() {}

AddressDiscovery.prototype.networkName = function(networkName) {
  this._networkName = networkName;
  return this;
}

AddressDiscovery.prototype.gapLimit = function(gapLimit) {
  this._gapLimit = gapLimit;
  return this;
}

AddressDiscovery.prototype.wallet = function(wallet) {
  this._accounts = [wallet.external, wallet.internal];
  return this;
}

AddressDiscovery.prototype.accounts = function(accounts) {
  this._accounts = [].concat.apply([], arguments);
  return this;
}

AddressDiscovery.prototype.commonBlockchain = function(commonBlockchain) {
  this._commonBlockchain = commonBlockchain;
  return this;
}

AddressDiscovery.prototype.discover = function(cb) {
  var networkName = this._networkName || 'bitcoin';
  var commonBlockchain = this._commonBlockchain || commonBlockchains(networkName);
  var accounts = this._accounts;
  var gapLimit = this._gapLimit || 20;
  var tasks = accounts.map(function(account) {
    if (!account.addresses)
      account.addresses = [];

    return discoverAddresses.bind(null, {
      account: account, 
      commonBlockchain: commonBlockchain,
      gapLimit: gapLimit
    });
  });

  parallel(tasks, function(err, results) {
    if (err) return cb(err);

    for (var i = 0; i < accounts.length; i++) {
      var account = accounts[i];

      var result = results[i];
      if (!result) continue;

      for (var j = 0; j < result.length; j++) {
        var address = result[j];
        if (account.addresses.indexOf(address) === -1) 
          account.addresses.push(address);
      }
    }

    cb();
  });
}

function discoverAddresses(options, done) {
  var account = options.account;
  var commonBlockchain = options.commonBlockchain;
  var gapLimit = options.gapLimit;
  var usedAddresses = [];

  discover(account, gapLimit, processBatch, function(err, k) {
    if (err) return done(err);

    console.info('Discovered ' + k + ' addresses')

    done(null, usedAddresses.slice(0, k))
  });

  function processBatch(addresses, callback) {
    commonBlockchain.addresses.summary(addresses, function(err, results) {
      if (err) return callback(err);

      var used = results.map(function(addr) {
        if (addr.totalReceived > 0) {
          usedAddresses.push(addr);
          return true;
        }
      });

      callback(null, used);
    })
  }
}

module.exports = AddressDiscovery;