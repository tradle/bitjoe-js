
'use strict';

var test = require('tape');
var cryptoUtils = require('../lib/crypto');
var crypto = require('crypto');
var TransactionData = require('../lib/transactionData');
var Permission = require('../lib/permission');
var bitcoin = require('bitcoinjs-lib');
var _ = require('lodash');
var bufferEqual = require('buffer-equal');
var ECKey = bitcoin.ECKey;

test('string <--> buffer conversion', function(t) {
  t.plan(2);

  var buf = crypto.randomBytes(128);
  var str = buf.toString('binary');
  var recoveredBuf = new Buffer(str, 'binary');

  t.ok(bufferEqual(buf, recoveredBuf));

  str = 'oh the blah blah';
  buf = new Buffer(str, 'binary');
  var recoveredStr = buf.toString('binary');

  t.equal(str, recoveredStr);
});

test('aes encrypt/decrypt', function(t) {
  t.plan(4);

  var str = 'blahblahoiblah';
  var pass = 'password';
  var encrypted = cryptoUtils.encrypt(str, pass);
  var decrypted = cryptoUtils.decrypt(encrypted, pass);

  t.notEqual(str, encrypted);
  t.equal(str, decrypted);

  var buf = crypto.randomBytes(32);
  pass = crypto.randomBytes(32);
  encrypted = cryptoUtils.encrypt(buf, pass);
  decrypted = cryptoUtils.decrypt(encrypted, pass);

  t.ok(!bufferEqual(buf, encrypted));
  t.ok(bufferEqual(buf, decrypted));
  
  buf = crypto.randomBytes(128);
  // t.ok(bufferEqual(buf, cryptoUtils.fileToBuf(cryptoUtils.fileToString(buf))));
});

test('ecdh', function(t) {
  t.plan(1);

  var a = ECKey.makeRandom();
  var b = ECKey.makeRandom();

  // var ab = a.pub.Q.multiply(b.d).getEncoded();
  // var ba = b.pub.Q.multiply(a.d).getEncoded();

  var ab = cryptoUtils.sharedEncryptionKey(a.d, b.pub);
  var ba = cryptoUtils.sharedEncryptionKey(b.d, a.pub);

  t.ok(bufferEqual(ab, ba));
});

test('transaction data', function(t) {
  t.plan(_.size(TransactionData.types) * 2);

  var prefix = 'blah';
  for (var type in TransactionData.types) {
    var typeCode = TransactionData.types[type];
    var data = crypto.randomBytes(40);
    var tData = new TransactionData(prefix, typeCode, data);
    var serialized = tData.serialize();
    var deserialized = TransactionData.deserialize(serialized, prefix);
    var parsedData = deserialized.data();

    t.ok(bufferEqual(data, parsedData));
    t.equal(typeCode, deserialized.type());
  }
});

test('permission file', function(t) {
  t.plan(2);

  var key1 = ECKey.makeRandom();
  var key2 = ECKey.makeRandom();

  var fileHash = crypto.randomBytes(40);
  var fileKey = crypto.randomBytes(32);

  var permission = new Permission(fileHash, fileKey);
  var encryptionKey = cryptoUtils.sharedEncryptionKey(key1.d, key2.pub);
  var decryptionKey;
  var decryptedPermission;
  permission.encrypt(encryptionKey);

  permission.build()
    .then(function() {
      var encryptedPermission = permission.data();
      decryptionKey = cryptoUtils.sharedEncryptionKey(key2.d, key1.pub);
      decryptedPermission = Permission.recover(encryptedPermission, decryptionKey);

      return decryptedPermission.build();
    })
    .then(function() {    
      t.ok(bufferEqual(encryptionKey, decryptionKey));
      t.ok(_.isEqual(decryptedPermission.body(), permission.body()));
    });
});

test('permission file + transaction construction, reconstruction', function(t) {
  t.plan(6);

  var prefix = 'blah';
  var key1 = ECKey.makeRandom();
  var key2 = ECKey.makeRandom();

  var fileHash = crypto.randomBytes(40);
  var fileKey = crypto.randomBytes(32);

  var permission = new Permission(fileHash, fileKey);
  var encryptionKey = cryptoUtils.sharedEncryptionKey(key1.d, key2.pub);
  permission.encrypt(encryptionKey);

  permission.build()
  .then(function() {

    var typeCode = TransactionData.types.ENCRYPTED_SHARE;
    var encryptedPermissionKey = permission.encryptedKey();

    var tData = new TransactionData(prefix, typeCode, encryptedPermissionKey);
    var serialized = tData.serialize();
    var deserialized = TransactionData.deserialize(serialized, prefix);

    // #1
    t.equal(typeCode, deserialized.type());

    var parsedPermissionKey = deserialized.data();

    // #2
    t.ok(bufferEqual(parsedPermissionKey, encryptedPermissionKey));
    // #3

    var decryptionKey = cryptoUtils.sharedEncryptionKey(key2.d, key1.pub);
    t.ok(bufferEqual(permission.key(), cryptoUtils.decrypt(encryptedPermissionKey, decryptionKey)));

    var permissionData = permission.data();
    var parsedPermission = Permission.recover(permissionData, decryptionKey);

    parsedPermission.build()
    .then(function() {
      // #4
      t.ok(_.isEqual(parsedPermission.body(), permission.body()));
      // #5
      t.ok(bufferEqual(fileHash, parsedPermission.fileKeyBuf()));
      // #6
      t.ok(bufferEqual(fileKey, parsedPermission.decryptionKeyBuf()));
    }, t.fail)
  });
});