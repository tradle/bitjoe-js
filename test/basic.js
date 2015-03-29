var taptest = require('tape');
var fs = require('fs');
var path = require('path');
var app = require('./fixtures/app');
var fakeKeeper = require('./helpers/fakeKeeper');
var DataLoader = require('../lib/dataLoader');
var Scanner = require('../lib/scanner');
var common = require('../lib/common');
var Joe = require('../');
var sharedKeeper = fakeKeeper.forMap({});
var config = {
  wallet: {
    autosave: true,
    path: './test/test.wallet'
  },
  autofund: false,
  keeper: sharedKeeper,
  prefix: 'test',
  networkName: 'testnet',
  syncInterval: 10000,
  minConf: 0
};

taptest('current block height', function(t) {
  t.plan(1);

  common.currentBlockHeight('testnet')
    .done(function(height) {
      t.ok(typeof height === 'number');
    });
});

taptest('destroy waits for save and queue save to finish', function(t) {
  t.plan(2);

  var joe = new Joe(config);
  joe.on('ready', function() {
    joe.queueSave(config.wallet); // immediate
    joe.queueSave(config.wallet); // queued
    joe.queueSave(config.wallet); // (should be) ignored
    joe.destroy();
    joe.on('save', t.pass);
    joe.on('save:error', t.error);
  });
});

taptest('1 sync at a time', function(t) {
  t.plan(2);

  var joe = new Joe(config);
  joe.on('ready', function() {
    var promise = joe.sync();
    t.ok(promise === joe.sync());
    joe.destroy().done(t.pass);
  });
});

taptest('scan blockchain for public data', function(t) {
  var models = app.models.bodies;
  var map = {};
  [
    '8e2b8d39cf77de22a028e26769003b29a43348ac',
    'f89ad154207d45ef031601fe50b270ca27a811f3'
  ].forEach(function(key, i) {
    map[key] = models[i];
  })

  // same file stored 4 times

  var numFiles = Object.keys(map).length;
  t.plan(numFiles);

  var scanner = new Scanner({
      keeper: fakeKeeper.forMap(map),
      networkName: 'testnet',
      prefix: 'tradle'
    })
    .from(321997)
    .to(322003)
    .scan(function(err) {
      t.error(err);
    })
    .on('file:public', function(info) {
      var file = info.file.body;
      var fileKey = info.file.key;
      t.deepEqual(file, map[fileKey]);
      if (--numFiles === 0) {
        scanner.stop();
      }
    })
});

taptest('load app models from list of model-creation tx ids', function(t) {
  t.plan(1);

  var models = app.models.bodies;
  fakeKeeper.forData(models)
    .then(function(keeper) {
      var loader = new DataLoader({
        networkName: 'testnet',
        keeper: keeper
      });

      return loader.load(app.models.txIds);
    })
    .then(function(_models) {
      t.deepEqual(_models, models);
    })
});

taptest('cleanup', function(t) {
  fs.unlink(path.resolve(config.wallet.path), t.end);
})
