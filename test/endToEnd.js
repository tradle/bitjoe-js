
'use strict';

var taptest = require('tape');
var utils = require('tradle-utils');
var Q = require('q');
var app = require('./fixtures/app');
var Joe = require('../');
var fakeKeeper = require('./helpers/fakeKeeper');
var bufferEqual = require('buffer-equal');
var extend = require('extend');
// var rimraf = require('rimraf');
var multipart = require('chained-obj');
var common = require('./common');
var joes = [];
var numJoes = 2;
// var MIN_CHARGE = 1e4;

taptest('setup bitjoe', function(t) {
  var tasks;
  var sharedKeeper = fakeKeeper.forMap({});
  var config = {
    wallet: {
      path: './test/joe.wallet',
      autosave: true
    },
    keeper: sharedKeeper,
    prefix: 'test',
    networkName: 'testnet',
    syncInterval: 10000,
    minConf: 0
  };

  for (var i = 0; i < numJoes; i++) {
    var conf = extend(true, {}, config);
    conf.wallet.path += i;
    joes.push(new Joe(conf));
  }

  tasks = joes.map(function(joe, i) {
    if (i === 0) return common.promiseFund(joe);
    else return common.promiseReady(joe);
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
      return common.recharge(joe);
    })
    .done(function() {
      endIn(t, 2000); // throttle
    })
});

taptest('create a public file + attachment, load it (multipart)', function(t) {
  if (!joes) return t.end();

  var joe = joes[0]; // funded joe
  var file = app.models.bodies[0];
  var attachment = './test/fixtures/logo.png';

  var sentBuf;
  var mb = multipart.Builder()
    .data(file)
    .attach('logo', attachment);

  Q.ninvoke(mb, 'build')
    .then(function(buf) {
      sentBuf = buf;
      // var fileBuf = new Buffer(JSON.stringify(file));
      var getInfoHash = Q.ninvoke(utils, 'getInfoHash', buf);
      var createPromise = joe.create()
        .data(buf)
        .setPublic(true)
        .execute();

      return Q.all([
        getInfoHash,
        createPromise
      ]);
    })
    .spread(function(infoHash, resp) {
      t.equal(infoHash, resp.fileKey);
      return joe.keeper()
        .getOne(resp.fileKey);
    })
    .then(function(storedFile) {
      t.ok(bufferEqual(storedFile, sentBuf));
      return Q.ninvoke(multipart.Parser, 'parse', storedFile);
    })
    .then(function(parsed) {
      t.deepEqual(JSON.parse(parsed.data.value), file);
      t.equal(parsed.attachments.length, 1);
      return common.recharge(joe);
    })
    .done(function() {
      endIn(t, 2000); // throttle
    })
});

taptest('create a shared encrypted file, load it', function(t) {
  if (!joes) return t.end();

  t.timeoutAfter(200000);

  var file = app.models.bodies[0];
  var sender = joes[0];
  var recipients = joes.slice(1);
  console.log('Creating a new file and sharing it');
  console.warn('This may take a minute');
  var recipientPubKeys = recipients.map(function(joe) {
    var addr = joe.getNextAddress();
    return joe.getPublicKeyForAddress(addr);
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
    joe.once('file:permission', function(info) {
      recipientPubKeys.forEach(function(pubKey) {
        var permission = createResp.permissions[pubKey.toHex()];
        t.ok(permission);
        t.equal(info.key, permission.key);
      });
    });

    joe.once('file:shared', function(info) {
      t.equal(info.key, createResp.fileKey);

      if (--numToGo > 0) return;

      common.recharge(joe)
        .done(function() {
          endIn(t, 2000); // throttle
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
  console.warn('This may take a minute');

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

  recipient.on('file:permission', function onPermission(info) {
    if (info.tx.getId() === shareResp.tx.getId()) {
      recipient.removeListener('file:permission', onPermission);
      var permission = shareResp.permission;
      t.ok(permission);
      t.equal(info.key, permission.key().toString('hex'));
    }
  });

  recipient.on('file:shared', function onSharedFile(info) {
    if (info.tx.getId() === shareResp.tx.getId()) {
      recipient.removeListener('file:shared', onSharedFile);
      t.equal(info.key, createResp.fileKey);
      // endIn(t, 2000); // throttle
      t.end();
    }
  });

  sender.on('error', t.error);
  recipient.on('error', t.error);
});

taptest('cleanup', function(t) {
  if (!joes) return t.end();

  Q.all(joes.map(function(joe) {
      return joe.destroy();
    }))
    // .then(function() {
    //   return Q.all(joes.map(function(j) {
    //     return Q.nfcall(rimraf, j.config('wallet').path);
    //   }))
    // })
    .done(function() {
      t.end();
    })
});

function endIn(t, timeout) {
  console.log('Throttling common-blockchain calls');
  setTimeout(function() {
    console.log('Ready for more common-blockchain calls');
    t.end()
  }, timeout); // hack to throttle common-blockchain api calls
}
