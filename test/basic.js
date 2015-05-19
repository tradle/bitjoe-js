var test = require('tape');
var Q = require('q');
var rimraf = require('rimraf');
var path = require('path');
var blockHeight = require('../lib/common').currentBlockHeight;
var Joe = require('../');
var common = require('./common');
var config = common.config();

test('current block height', function(t) {
  t.plan(1);

  blockHeight('testnet')
    .done(function(height) {
      t.ok(typeof height === 'number');
    });
});

test('multiple saves result in last save', function(t) {
  t.plan(2);

  var joe = new Joe(config);
  joe.on('ready', function() {
    var tasks = [];
    for (var i = 0; i < 10; i++) {
      joe.wallet().gapLimit++;
      tasks.push(joe.save());
    }

    var gapLimit = joe.wallet().gapLimit;
    Q.all(tasks)
      .then(function() {
        return joe.destroy();
      })
      .then(function() {
        joe = new Joe(joe.config());
        joe.on('ready', function() {
          t.equal(joe.wallet().gapLimit, gapLimit);
          joe.destroy().then(t.pass);
        });
      })
      .done();
  });
});

test('1 sync at a time', function(t) {
  t.plan(2);

  var joe = new Joe(config);
  joe.on('ready', function() {
    var promise = joe.sync();
    t.ok(promise === joe.sync());
    joe.destroy().done(t.pass);
  });
});

test('cleanup', function(t) {
  rimraf(path.resolve(config.wallet.path), t.end);
})
