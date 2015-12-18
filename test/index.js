'use strict'

var test = require('tape')
var utils = require('@tradle/utils')
var encryptAsync = utils.encryptAsync
var TEST_IV = new Buffer('f5bc75d07a12c86b581c5719e05e9af4', 'hex')
utils.encryptAsync = function (opts, cb) {
  opts.iv = TEST_IV
  return encryptAsync.call(utils, opts, cb)
}

var Q = require('q')
var bitcoin = require('@tradle/bitcoinjs-lib')
var app = require('./fixtures/app')
var resps = require('./fixtures/resps')
var TxData = require('@tradle/tx-data').TxData
var common = require('./common')
var CreateReq = require('../lib/requests/create')
// var mi = require('midentity')
CreateReq.prototype._generateSymmetricKey = function () {
  return Q(new Buffer('1111111111111111111111111111111111111111111111111111111111111111', 'hex'))
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
      compareResps(t, resp, resps[0])
      return chainloader.load(txs)
    })
    .done(function (loaded) {
      loaded = loaded[0].value
      t.equal(loaded.key, '8e2b8d39cf77de22a028e26769003b29a43348ac')
      t.equal(loaded.txType, TxData.types.public)
      t.deepEqual(loaded.data, fileBuf)
      t.end()
    })
})

// test('create a public file + attachment, load it (multipart)', function (t) {
//   t.timeoutAfter(2000)

//   var file = app.models[0]
//   var txs = []
//   var joe = common.mkJoe(joeWif, function send (tx) {
//     txs.push(tx)
//   })

//   var chainloader = common.chainloaderFor(joe, friends)
//   var attachment = './test/fixtures/logo.png'

//   var sentBuf
//   var mb = multipart.Builder()
//     .data(file)
//     .attach({
//       name: 'logo',
//       path: attachment
//     })

//   Q.ninvoke(mb, 'build')
//     .then(function (build) {
//       var buf = build.form
//       sentBuf = buf
//       var getInfoHash = Q.ninvoke(utils, 'getInfoHash', buf)
//       var createPromise = joe.create()
//         .data(buf)
//         // .shareWith(bitcoin.ECKey.fromWIF(friends[0]).pub)
//         .setPublic(true)
//         .execute()
//         .then(chainPublic.bind(null, joe))

//       return Q.all([
//         getInfoHash,
//         createPromise
//       ])
//     })
//     .spread(function (infoHash, resp) {
//       compareResps(t, resp, resps[1])
//       return chainloader.load(txs)
//     })
//     .then(function (loaded) {
//       loaded = loaded[0].value
//       t.equal(loaded.key, 'c3124d6980ecb72ee344af8c64d053cf1249c235')
//       t.equal(loaded.txType, TxData.types.public)
//       t.deepEqual(loaded.data, sentBuf)
//       return Q.ninvoke(multipart.Parser, 'parse', loaded.data)
//     })
//     .done(function (parsed) {
//       t.deepEqual(parsed.data, file)
//       t.equal(parsed.attachments.length, 1)
//       t.end()
//     })
// })

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
      t.equal(resp.key, 'acca36d024b769ef7192f9419ab50758a2b4822b')
      return joe.share()
        .shareAccessWith(friendPub)
        .shareAccessTo(resp.key, createReq._symmetricKey)
        .execute()
    })
    .then(chainShared.bind(null, joe))
    .then(function (resp) {
      var p = resp.permission
      t.equal(p.key().toString('hex'), 'e8b0f3fcd91c809e1128c45bf14a4aa9e2a13da8')
      t.equal(p.fileKeyString(), 'acca36d024b769ef7192f9419ab50758a2b4822b')
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
      loaded = loaded.map(function (l) { return l.value })
      loaded.forEach(function (l, i) {
        t.equal(l.key, 'acca36d024b769ef7192f9419ab50758a2b4822b')
        t.equal(l.permission.fileKeyString(), 'acca36d024b769ef7192f9419ab50758a2b4822b')
        t.equal(l.txType, TxData.types.permission)
        t.equal(l.from.key.priv, joeWif)
        t.equal(l.to.key.value, bitcoin.ECKey.fromWIF(friends[i]).pub.toHex())
        t.equal(l.tx.toHex(), txs[i].toHex())
      })

      t.equal(loaded[0].permissionKey, '7a0e85e0ac1a444d1656818ec84c2738ba51b55b')
      t.equal(loaded[1].permissionKey, 'e8b0f3fcd91c809e1128c45bf14a4aa9e2a13da8')
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
