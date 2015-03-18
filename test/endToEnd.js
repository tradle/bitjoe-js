
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
var numJoes = 2;

taptest('setup bitjoe', function(t) {
  var tasks;
  var sharedKeeper = fakeKeeper.forMap({});
  var config = {
    wallet: {
      autosave: false
    },
    keeper: sharedKeeper,
    prefix: 'test',
    networkName: 'testnet',
    syncInterval: 10000,
    minConf: 0
  };

  for (var i = 0; i < numJoes; i++) {
    var conf = extend(true, {}, config);
    joes.push(new Joe(conf));
  }

  tasks = joes.map(function(joe, i) {
    if (i === 0) return promiseFund(joe);
    else return promiseReady(joe);
  })

  Q.all(tasks)
    .done(function() {
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
      return recharge(joe);
    })
    .done(function() {
      endIn(t, 10000); // throttle
    })
});

taptest('create a shared encrypted file, load it', function(t) {
  if (!joes) return t.end();

  t.timeoutAfter(200000);

  var file = app.models.bodies[0];
  var sender = joes[0];
  var recipients = joes.slice(1);
  console.log('Creating a new file and sharing it');
  console.warn('This make take a minute');
  var recipientPubKeys = recipients.map(function(joe) {
    var addr = joe.getNextAddress();
    var pubKey = joe.getPublicKeyForAddress(addr);
    return pubKey;
  });

  var numToGo = recipients.length;
  var createResp;
  sender.create()
    .data(file)
    .shareWith(recipientPubKeys)
    .execute()
    .done(function(resp) {
      createResp = resp;
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

      if (--numToGo > 0) return;

      recharge(joe)
        .done(function() {
          endIn(t, 10000); // throttle
        })
    });

    joe.on('error', t.error);
  });
});

taptest('share an existing file with someone new', function(t) {
  if (!joes) return t.end();

  t.timeoutAfter(200000);

  var file = app.models.bodies[1];
  var createResp;
  var shareResp;
  var sender = joes[0];
  var recipient = joes[1];
  var recipientAddr = recipient.getNextAddress();
  var recipientPubKey = recipient.getPublicKeyForAddress(recipientAddr).toHex();
  console.log('Sharing existing file with: ' + recipientAddr + ' : ' + recipientPubKey);
  console.warn('This make take a minute or two');

  var createReq = sender.create().data(file);
  createReq.execute()
    .then(function(resp) {
      createResp = resp;
      var defer = Q.defer();
      // throttle
      setTimeout(function() {
        return sender.share()
          .shareAccessWith(recipientPubKey)
          .shareAccessTo(createResp.fileKey, createReq._symmetricKey)
          .execute()
          .done(defer.resolve);
      }, 10000);

      return defer.promise;
    })
    .done(function(resp) {
      shareResp = resp;
    });

  recipient.once('file:permission', function(file, fileKey) {
    var permission = shareResp.permissions[recipientPubKey];
    t.ok(permission);
    t.equal(fileKey, permission.key);
  });

  recipient.once('file:shared', function(file, fileKey) {
    t.equal(fileKey, createResp.fileKey);
    endIn(t, 10000); // throttle
  });

  sender.on('error', t.error);
  recipient.on('error', t.error);
});

taptest('cleanup', function(t) {
  if (!joes) return t.end();

  Q.all(joes.map(function(joe) {
      return joe.destroy();
    }))
    .done(function() {
      t.end();
    })
});

function promiseFund(joe, amount) {
  return Q.Promise(function(resolve, reject) {
    amount = amount || 1e5;
    joe.on('ready', function() {
      recharge(joe, 1e5);
    });

    joe.on('sync', checkBalance);

    function checkBalance() {
      var balance = joe.getBalance(0);
      if (balance < amount) return;

      console.log('Funded from faucet: ' + balance);
      joe.removeListener('sync', checkBalance);
      joe.removeListener('ready', checkBalance);
      resolve();
    }
  });
}

function promiseReady(joe) {
  var defer = Q.defer();
  joe.once('ready', defer.resolve);
  return defer.promise;
}

function endIn(t, timeout) {
  console.log('Throttling common-blockchain calls');
  setTimeout(function() {
    console.log('Ready for more common-blockchain calls');
    t.end()
  }, timeout); // hack to throttle common-blockchain api calls
}

function recharge(joe, satoshis) {
  return joe.charge(1, satoshis || 1e5)
    .then(joe.sync);
}
