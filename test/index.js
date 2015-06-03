'use strict'

var test = require('tape')
var utils = require('tradle-utils')
var Q = require('q')
var bitcoin = require('bitcoinjs-lib')
var app = require('./fixtures/app')
var resps = require('./fixtures/resps')
var bufferEqual = require('buffer-equal')
var multipart = require('chained-obj')
var common = require('./common')
var TxReq = require('../lib/requests/transactionRequest')
var testnet = bitcoin.networks.testnet
// var mi = require('midentity')
TxReq.prototype._generateSymmetricKey = function () {
  return new Buffer('1111111111111111111111111111111111111111111111111111111111111111')
}

var joeWif = 'cNPQ8SgxZLfdMBMhhnQCu4HAg8VV1L5C3AnH3t5s7WMt43t7qPHL'
var friends = [
  'cTz3gugF7jGp6dsudvAkg5dYKzQyN6XSxJH4v94k9T8E2itbMXbr',
  'cNmzn9BBsPfBmSWYjDhSYJDg6BWMN3jd46GNgZpnV4QabSpEY5fs'
]

test('create a public file, load it', function (t) {
  t.timeoutAfter(2000)

  var file = app.models[0]
  var fileBuf = new Buffer(JSON.stringify(file))
  var txs = []
  var joe = common.mkJoe(joeWif, function send (tx) {
    txs.push(tx)
  })

  var chainloader = common.chainloaderFor(joe, friends)
  var getInfoHash = Q.ninvoke(utils, 'getInfoHash', fileBuf)
  var createPromise = joe.create()
    .data(file)
    .setPublic(true)
    .execute()

  Q.all([
    getInfoHash,
    createPromise
  ])
    .spread(function (infoHash, resp) {
      t.equal(infoHash, resp.fileKey)
      t.deepEqual(resp, resps[0])
      t.deepEqual(getTxIds(txs), [
        '0b5cd0e1495a08b2bce2d56ed7b31afb897d296e8ccd0bc03f71b8405d966d0b'
      ])

      return chainloader.load(txs)
    })
    .done(function (loaded) {
      loaded = loaded[0]
      t.equal(loaded.key, '8e2b8d39cf77de22a028e26769003b29a43348ac')
      t.equal(loaded.type, 'public')
      t.ok(bufferEqual(loaded.file, fileBuf))
      t.end()
    })
})

test('create a public file + attachment, load it (multipart)', function (t) {
  t.timeoutAfter(2000)

  var file = app.models[0]
  var txs = []
  var joe = common.mkJoe(joeWif, function send (tx) {
    txs.push(tx)
  })

  var chainloader = common.chainloaderFor(joe, friends)
  var attachment = './test/fixtures/logo.png'

  var sentBuf
  var mb = multipart.Builder()
    .data(file)
    .attach({
      name: 'logo',
      path: attachment
    })

  Q.ninvoke(mb, 'build')
    .then(function (buf) {
      sentBuf = buf
      var getInfoHash = Q.ninvoke(utils, 'getInfoHash', buf)
      var createPromise = joe.create()
        .data(buf)
        .setPublic(true)
        .execute()

      return Q.all([
        getInfoHash,
        createPromise
      ])
    })
    .spread(function (infoHash, resp) {
      t.equal(infoHash, resp.fileKey)
      t.deepEqual(resp, resps[1])
      t.deepEqual(getTxIds(txs), [
        'f9060668201323e0211ea7ced4dc2e3fd62c7e6c3a040fe04a51ccfa45844c5f'
      ])

      return chainloader.load(txs)
    })
    .then(function (loaded) {
      loaded = loaded[0]
      t.equal(loaded.key, '2cedcb947f58610f45f2f31c30aba8907274613a')
      t.equal(loaded.type, 'public')
      t.ok(bufferEqual(loaded.file, sentBuf))
      return Q.ninvoke(multipart.Parser, 'parse', loaded.file)
    })
    .done(function (parsed) {
      t.deepEqual(parsed.data.value, file)
      t.equal(parsed.attachments.length, 1)
      t.end()
    })
})

test('create a shared encrypted file, load it', function (t) {
  t.timeoutAfter(2000)

  var file = app.models[0]
  var txs = []
  var joe = common.mkJoe(joeWif, function send (tx) {
    txs.push(tx)
  })

  var chainloader = common.chainloaderFor(joe, friends)
  var friendPubs = friends.map(function (pk) {
    return bitcoin.ECKey.fromWIF(pk).pub
  })

  joe.create()
    .data(file)
    .shareWith(friendPubs)
    .execute()
    .then(function (resp) {
      t.deepEqual(resp, resps[2])
      return checkShared(t, txs, chainloader)
    })
    .done(t.end)
})

test('share an existing file with someone new', function (t) {
  t.timeoutAfter(2000)

  var file = app.models[0]
  var txs = []
  var joe = common.mkJoe(joeWif, function send (tx) {
    txs.push(tx)
  })

  var chainloader = common.chainloaderFor(joe, friends)
  var createReq = joe
    .create()
    .data(file)
    .shareWith(bitcoin.ECKey.fromWIF(friends[0]).pub)

  var friendPub = bitcoin.ECKey.fromWIF(friends[1]).pub
  createReq.execute()
    .then(function (resp) {
      t.equal(resp.fileKey, 'fe1a956ab380fac75413fb73c0c5b30f11518124')
      return joe.share()
        .shareAccessWith(friendPub)
        .shareAccessTo(resp.fileKey, createReq._symmetricKey)
        .execute()
    })
    .then(function (resp) {
      var p = resp.permission
      t.equal(p.key().toString('hex'), '3012abba72f239a70ad207c78e4afdb68adfcad3')
      t.equal(p.fileKeyString(), 'fe1a956ab380fac75413fb73c0c5b30f11518124')
      return checkShared(t, txs, chainloader)
    })
    .done(t.end)
})

function getTxIds (txs) {
  return txs.map(function (tx) { return tx.getId() })
}

function checkShared (t, txs, chainloader) {
  t.deepEqual(getTxIds(txs), [
    '7bb841e1026fbe80932cad0a2257d4a8f896927681dd7ff301b8f2b9b67107b5',
    '44e04bbd7d6546fcf5962c0b5440d99c43c91730683bae3d674e31e007ef75f4'
  ])

  return chainloader.load(txs)
    .then(function (loaded) {
      loaded.forEach(function (l, i) {
        t.equal(l.key, 'fe1a956ab380fac75413fb73c0c5b30f11518124')
        t.equal(l.permission.fileKeyString(), 'fe1a956ab380fac75413fb73c0c5b30f11518124')
        t.equal(l.type, 'sharedfile')
        t.equal(l.from.key.priv().toWIF(testnet), joeWif)
        t.equal(l.to.key.priv().toWIF(testnet), friends[i])
        t.equal(l.from.identity, chainloader.identity)
        t.equal(l.tx.body, txs[i])
      })

      t.equal(loaded[0].permissionKey, '51dd7c56596ed43a9f6d8eaaaa1ec1a78e81de98')
      t.equal(loaded[1].permissionKey, '3012abba72f239a70ad207c78e4afdb68adfcad3')
    })
}
