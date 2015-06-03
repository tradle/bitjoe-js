'use strict'

var test = require('tape')
var utils = require('tradle-utils')
var Q = require('q')
var bitcoin = require('bitcoinjs-lib')
var app = require('./fixtures/app')
var resps = require('./fixtures/resps')
var bufferEqual = require('buffer-equal')
var multipart = require('chained-obj')
var testCommon = require('./common')
var TxReq = require('../lib/requests/transactionRequest')
TxReq.prototype._generateSymmetricKey = function () {
  return new Buffer('1111111111111111111111111111111111111111111111111111111111111111')
}

var privateWifs = [
  'cNPQ8SgxZLfdMBMhhnQCu4HAg8VV1L5C3AnH3t5s7WMt43t7qPHL',
  'cTz3gugF7jGp6dsudvAkg5dYKzQyN6XSxJH4v94k9T8E2itbMXbr',
  'cNmzn9BBsPfBmSWYjDhSYJDg6BWMN3jd46GNgZpnV4QabSpEY5fs'
]

test('create a public file, load it', function (t) {
  t.plan(3)
  var model = app.models[0]

  var joe = testCommon.mkJoe(privateWifs[0])

  var file = model.body
  var fileBuf = new Buffer(JSON.stringify(file))
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
      return joe.keeper()
        .getOne(resp.fileKey)
    })
    .done(function (storedFile) {
      t.ok(bufferEqual(storedFile, fileBuf))
    })
})

test('create a public file + attachment, load it (multipart)', function (t) {
  t.plan(5)

  var joe = testCommon.mkJoe(privateWifs[0])

  var model = app.models[0]
  var file = model.body
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
      return joe.keeper()
        .getOne(resp.fileKey)
    })
    .then(function (storedFile) {
      t.ok(bufferEqual(storedFile, sentBuf))
      return Q.ninvoke(multipart.Parser, 'parse', storedFile)
    })
    .then(function (parsed) {
      t.deepEqual(parsed.data.value, file)
      t.equal(parsed.attachments.length, 1)
    })
})

test('create a shared encrypted file, load it', function (t) {
  t.plan(1)

  var model = app.models[0]
  var file = model.body
  var sender = testCommon.mkJoe(privateWifs[0])

  var recipientPubKeys = privateWifs.slice(1).map(function (pk) {
    return bitcoin.ECKey.fromWIF(pk).pub
  })

  sender.create()
    .data(file)
    .shareWith(recipientPubKeys)
    .execute()
    .done(function (resp) {
      t.deepEqual(resp, resps[2])
    })
})

test('share an existing file with someone new', function (t) {
  t.plan(4)

  var model = app.models[0]
  var file = model.body
  var sender = testCommon.mkJoe(privateWifs[0])

  var recipientPubKey = bitcoin.ECKey.fromWIF(privateWifs[1]).pub
  var createReq = sender
    .create()
    .data(file)
    .shareWith(bitcoin.ECKey.fromWIF(privateWifs[2]).pub)

  createReq.execute()
    .then(function (resp) {
      t.equal(resp.fileKey, 'fe1a956ab380fac75413fb73c0c5b30f11518124')
      return sender.share()
        .shareAccessWith(recipientPubKey)
        .shareAccessTo(resp.fileKey, createReq._symmetricKey)
        .execute()
    })
    .done(function (resp) {
      var p = resp.permission
      t.equal(p.key().toString('hex'), '51dd7c56596ed43a9f6d8eaaaa1ec1a78e81de98')
      t.equal(p.fileKeyString(), 'fe1a956ab380fac75413fb73c0c5b30f11518124')
      t.equal(resp.tx.toHex(), model.tx.share)
    })
})
