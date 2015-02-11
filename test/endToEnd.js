
'use strict';

var taptest = require('tape');
var utils = require('tradle-utils');
var Q = require('q');
var app = require('./fixtures/app');
var Joe = require('../');
var fakeKeeper = require('./helpers/fakeKeeper');
var bufferEqual = require('buffer-equal');
var extend = require('extend');
var joes = [];

taptest('setup bitjoe', function(t) {
  var numJoes = 2;
  var tasks;
  var sharedKeeper = fakeKeeper.forMap({});
  var config = {
    wallet: {
      autosave: false
      // ,
      // path: 'wallet/joeWallet.wallet',
      // password: 'bogus'
    },
    keeper: sharedKeeper,
    prefix: 'test',
    networkName: 'testnet',
    syncInterval: 5000,
    minConf: 0
  };

  for (var i = 0; i < numJoes; i++) {
    var conf = extend(true, {
      autofund: i === 0
    }, config);

    // conf.wallet.path = conf.wallet.path.replace('.wallet', i + '.wallet');
    joes.push(new Joe(conf));
  }

  tasks = joes.map(function(joe, i) {
    if (joe.config('autofund')) return promiseFund(joe);
    else return promiseReady(joe);
  })

  Q.all(tasks)
    .catch(function(err) {
      t.error(err);
      joes = null;
    })
    .finally(function() {
      t.end();
    })
});

taptest('create a public file, load it', function(t) {
  if (!joes) return t.end();

  var joe = joes[0]; // funded joe
  var file = app.models.bodies[0];
  var fileBuf = new Buffer(JSON.stringify(file));
  var getInfoHash = Q.ninvoke(utils, 'getInfoHash', fileBuf);
  var createPromise = joe.create()
    .data(file)
    .setPublic(true)
    .execute();

  Q.all([
      getInfoHash,
      createPromise
    ])
    .spread(function(infoHash, resp) {
      t.equal(infoHash, resp.fileKey);
      return joe.keeper()
        .getOne(resp.fileKey);
    })
    .then(function(storedFile) {
      t.ok(bufferEqual(storedFile, fileBuf));
    })
    .catch(function(err) {
      throw err;
    })
    .finally(function() {
      setTimeout(function() {
        t.end()
      }, 10000); // hack to throttle common-blockchain api calls
    })
});

taptest('create a shared encrypted file, load it', function(t) {
  if (!joes) return t.end();

  t.timeoutAfter(200000);

  var file = app.models.bodies[0];
  var sender = joes[0];
  var recipients = joes.slice(1);
  var recipientPubKeys = recipients.map(function(joe) {
    var addr = joe.getNextAddress();
    var pubKey = joe.getPublicKeyForAddress(addr);
    console.log('Sharing with: ' + addr + ' : ' + pubKey.toHex());
    console.warn('This make take a minute or two');
    return pubKey;
  });

  var numToGo = recipients.length;
  var createResp;
  sender.create()
    .data(file)
    .shareWith(recipientPubKeys)
    .execute()
    .then(function(resp) {
      createResp = resp;
    })
    .catch(function(err) {
      throw err;
    });

  recipients.forEach(function(joe) {
    joe.once('file:permission', function(file, fileKey) {
      recipientPubKeys.forEach(function(pubKey) {
        var permission = createResp.permissions[pubKey.toHex()];
        t.ok(permission);
        t.equal(fileKey, permission.key);
      });
    });

    joe.once('file:shared', function(file, fileKey) {
      t.equal(fileKey, createResp.fileKey);

      if (--numToGo === 0) t.end();
    });

    joe.on('error', t.error);
  });

});

taptest('cleanup', function(t) {
  if (!joes) return t.end();

  Q.all(joes.map(function(joe) {
    // if (joe.getBalance(0) === 0) return Q.resolve();

    // return joe.refundToFaucet()
    //   .then(joe.destroy)
    // }))
      return joe.destroy();
    }))
    .catch(function(err) {
      throw err;
    })
    .finally(function() {
      t.end();
    });
});

function promiseFund(joe) {
  var fundDefer = Q.defer();
  joe.on('ready', checkBalance);
  joe.on('sync', checkBalance);
  return fundDefer.promise;

  function checkBalance() {
    var balance = joe.getBalance(0);
    if (balance < 10000) return;

    console.log('Funded from faucet: ' + balance);
    joe.removeListener('sync', checkBalance);
    joe.removeListener('ready', checkBalance);
    fundDefer.resolve();
  }
}

function promiseReady(joe) {
  var defer = Q.defer();
  joe.once('ready', defer.resolve);
  return defer.promise;
}
