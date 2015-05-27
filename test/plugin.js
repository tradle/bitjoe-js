var test = require('tape')
var FakeKeeper = require('tradle-test-helpers').FakeKeeper
var identity = require('./fixtures/identity')
var Bitjoe = require('../')
var extend = require('extend')
// var Identity = require('./helpers/fakePlugin')
var baseConfig = {
  wallet: {
    autosave: false
  },
  keeper: FakeKeeper.empty(),
  prefix: 'test',
  networkName: 'testnet',
  syncInterval: 10000,
  minConf: 0
}

test('plugin changes file', function (t) {
  var joe = new Bitjoe(baseConfig)

  var f1 = {
    processOutgoing: function (obj) {
      t.notOk(obj._plugged2)
      t.notOk(obj._plugged3)
      obj._plugged1 = true
      return obj
    }
  }

  var f2 = {
    processOutgoing: function (obj) {
      t.ok(obj._plugged1)
      t.notOk(obj._plugged3)
      obj._plugged2 = true
    // not returning obj should work just as well
    }
  }

  var f3 = {
    processOutgoing: function (obj) {
      t.ok(obj._plugged1)
      t.ok(obj._plugged2)
      var copy = extend({}, obj)
      copy._plugged3 = true
      return copy
    }
  }

  var f4 = {
    processOutgoing: function (obj) {
      t.fail('this handler should not have been called')
    }
  }

  joe.plugin(identity._type, f1)
  joe.plugin('*', f3) // catch-alls should come last
  joe.plugin(identity._type, f2)
  joe.plugin('some.other.type', f4)

  joe.on('ready', function () {
    joe.processOutgoingFile(identity)
      .then(function (updatedIdentity) {
        t.ok(updatedIdentity._plugged1)
        t.ok(updatedIdentity._plugged2)
        t.ok(updatedIdentity._plugged3)
        return joe.destroy()
      })
      .done(function () {
        t.end()
      })
  })
})

test('plugin gets called on outgoing file', function (t) {
  t.plan(1)

  var config = extend({}, baseConfig)
  config.autofund = 1e5
  var joe = new Bitjoe(config)

  var f1 = {
    processOutgoing: function (obj) {
      t.pass()
    }
  }

  joe.plugin(identity._type, f1)

  joe.on('ready', function () {
    joe.create()
      .data(identity)
      .setPublic(true)
      .execute()
      .done(function () {
        return joe.destroy()
      })
  })
})
