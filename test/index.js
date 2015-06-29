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
var CreateReq = require('../lib/requests/create')
// var mi = require('midentity')
CreateReq.prototype._generateSymmetricKey = function () {
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
    .then(chainPublic.bind(null, joe))

  Q.all([
      getInfoHash,
      createPromise
    ])
    .spread(function (infoHash, resp) {
      t.equal(infoHash, resp.key)
      compareResps(t, resp, resps[0])
      return chainloader.load(txs)
    })
    .done(function (loaded) {
      loaded = loaded[0]
      t.equal(loaded.key, '8e2b8d39cf77de22a028e26769003b29a43348ac')
      t.equal(loaded.type, 'public')
      t.ok(bufferEqual(loaded.data, fileBuf))
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
        // .shareWith(bitcoin.ECKey.fromWIF(friends[0]).pub)
        .setPublic(true)
        .execute()
        .then(chainPublic.bind(null, joe))

      return Q.all([
        getInfoHash,
        createPromise
      ])
    })
    .spread(function (infoHash, resp) {
      t.equal(infoHash, resp.key)
      compareResps(t, resp, resps[1])
      return chainloader.load(txs)
    })
    .then(function (loaded) {
      loaded = loaded[0]
      t.equal(loaded.key, '2cedcb947f58610f45f2f31c30aba8907274613a')
      t.equal(loaded.type, 'public')
      t.ok(bufferEqual(loaded.data, sentBuf))
      return Q.ninvoke(multipart.Parser, 'parse', loaded.data)
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
    .then(chainShared.bind(null, joe))
    .then(function (resp) {
      compareResps(t, resp, resps[2])
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
    .then(chainShared.bind(null, joe))
    .then(function (resp) {
      t.equal(resp.key, 'fe1a956ab380fac75413fb73c0c5b30f11518124')
      return joe.share()
        .shareAccessWith(friendPub)
        .shareAccessTo(resp.key, createReq._symmetricKey)
        .execute()
    })
    .then(chainShared.bind(null, joe))
    .then(function (resp) {
      var p = resp.permission
      t.equal(p.key().toString('hex'), 'c0ade471366346a70ec93999d2c7857af80b877b')
      t.equal(p.fileKeyString(), 'fe1a956ab380fac75413fb73c0c5b30f11518124')
      return checkShared(t, txs, chainloader)
    })
    .done(t.end)
})

function getTxIds (txs) {
  return txs.map(function (tx) { return tx.getId() })
}

function checkShared (t, txs, chainloader) {
  t.deepEqual(getTxIds(txs), resps[2].shares.map(function (s) {
    return s.txId
  }))
  return chainloader.load(txs)
    .then(function (loaded) {
      loaded.forEach(function (l, i) {
        t.equal(l.key, 'fe1a956ab380fac75413fb73c0c5b30f11518124')
        t.equal(l.permission.fileKeyString(), 'fe1a956ab380fac75413fb73c0c5b30f11518124')
        t.equal(l.type, 'sharedfile')
        t.equal(l.from.key.priv, joeWif)
        t.equal(l.to.key.value, bitcoin.ECKey.fromWIF(friends[i]).pub.toHex())
        t.equal(l.tx.body.toHex(), txs[i].toHex())
      })

      t.equal(loaded[0].permissionKey, '21f04a7b5141003bc254af7a56c257af0265bf38')
      t.equal(loaded[1].permissionKey, 'c0ade471366346a70ec93999d2c7857af80b877b')
    })
}

function compareResps (t, actual, expected) {
  t.deepEqual(actual.key, expected.key)
  if (!expected.shares) return

  expected.shares.forEach(function (s, i) {
    for (var p in s) {
      var val = actual.shares[i][p]
      if (val.toHex) {
        val = val.toHex()
      } else if (Buffer.isBuffer(val)) {
        val = val.toString('hex')
      }

      t.equal(val, s[p])
    }
  })
}

function chainPublic (joe, _resp) {
  var resp = _resp
  return joe.chain()
    .data(resp.key)
    .publish()
    .execute()
    .then(function (tx) {
      resp.tx = tx
      resp.txId = tx.getId()
      return resp
    })
}

function chainShared (joe, _resp) {
  var resp = _resp
  var shares = resp.shares || [resp]
  return Q.all(
    shares.map(function (s) {
      return joe.chain()
        .data(s.encryptedKey)
        .to(s.address.toString())
        .share()
        .execute()
    })
  )
  .then(function (txs) {
    txs.forEach(function (tx, i) {
      shares[i].tx = tx
      shares[i].txId = tx.getId()
    })

    return resp
  })
}
