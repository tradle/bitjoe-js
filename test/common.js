
var Q = require('q');
var Joe = require('../');
var fakeKeeper = require('./helpers/fakeKeeper');
var joes = [];
var rimraf = require('rimraf');
var mkdirp = require('mkdirp');
var walletsDir = './test/wallets/';
var crypto = require('crypto');
var test = require('tape');
var MIN_CHARGE = 1e4;
var noop = function() {};

rimraf.sync(walletsDir);
mkdirp.sync(walletsDir);

var common = module.exports = {
  cleanup: function(cb) {
    var copy = joes.slice();
    joes.length = 0;
    return Q.all(copy.map(function(joe) { return joe.destroy() }))
      .then(function() {
        return Q.nfcall(rimraf, walletsDir);
      })
      .done(cb || noop)
  },
  mkJoe: function() {
    var joe = new Joe(common.config());
    joes.push(joe);
    return joe;
  },
  mkJoes: function(num) {
    return common.nulls(num).map(function(i, idx) {
      return common.mkJoe();
    });
  },
  config: function() {
    return {
      wallet: {
        path: walletsDir + 'joe.' + crypto.randomBytes(32).toString('hex') + '.wallet',
        autosave: true
      },
      keeper: fakeKeeper.forMap({}),
      prefix: 'test',
      networkName: 'testnet',
      syncInterval: 10000,
      minConf: 0
    }
  },
  nulls: function(size) {
    var arr = [];
    while (size--) {
      arr.push(null);
    }

    return arr;
  },
  recharge: function recharge(joe, satoshis) {
    return joe.charge(2, satoshis || MIN_CHARGE)
      .then(joe.sync);
  },
  promiseFund: function(joe, amount) {
    var promise = Q.Promise(function(resolve, reject) {
      amount = amount || MIN_CHARGE;
      joe.on('ready', function() {
        if (checkBalance()) return;

        common.recharge(joe, MIN_CHARGE)
          .done(checkBalance);

        joe.wallet().on('tx', checkBalance);
      });

      function checkBalance() {
        var balance = joe.getBalance(0);
        if (balance < amount) return;

        joe.wallet().removeListener('tx', checkBalance);
        resolve();
        return true;
      }
    });

    return promise;
  },

  promiseReady: function(joe) {
    var defer = Q.defer();
    joe.once('ready', defer.resolve);
    return defer.promise;
  },

  rechargeAndTest: function(joe, satoshis, testName, fn) {
    if (!joe) return;
    if (joe.getBalance(0) > 2e4) return test(testName, fn);

    if (typeof satoshis === 'string') {
      testName = satoshis;
      satoshis = null;
    }

    return common.recharge(joe, satoshis)
      .then(function() {
        test(testName, fn);
      })
  }
}
