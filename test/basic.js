var taptest = require('tape');
var Q = require('q');
var fs = require('fs');
var path = require('path');
var pluck = require('array-pluck');
var app = require('./fixtures/app');
var fakeKeeper = require('./helpers/fakeKeeper');
var DataLoader = require('../lib/dataLoader');
var common = require('../lib/common');
var Blockchain = require('../lib/commonBlockchains');
var bitcoin = require('bitcoinjs-lib');
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

taptest('load app models from list of model-creation tx ids', function(t) {
  t.plan(1);

  var network = 'testnet';
  var api = new Blockchain(network);
  var models = app.models.bodies;
  var txIds = app.models.txIds;
  var loaded = [];
  Q.all([
      Q.ninvoke(api.transactions, 'get', txIds),
      fakeKeeper.forData(models)
    ])
    .spread(function(txs, keeper) {
      txs = txs.map(function(tx) {
        return bitcoin.Transaction.fromHex(tx.txHex);
      });

      var loader = new DataLoader({
        prefix: 'tradle',
        networkName: network,
        keeper: keeper
      });

      ['file:public', 'file:shared'].forEach(function(event) {
        loader.on(event, function(file) {
          loaded.push(file);
        });
      });

      return loader.load(txs);
    })
    .then(function() {
      t.deepEqual(pluck(loaded, 'file'), models);
    })
    .done();
});

taptest('cleanup', function(t) {
  fs.unlink(path.resolve(config.wallet.path), t.end);
})
