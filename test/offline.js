'use strict';

var taptest = require('tape');
var cryptoUtils = require('../lib/crypto');
var crypto = require('crypto');
var TransactionData = require('../lib/transactionData');
var Permission = require('../lib/permission');
var bitcoin = require('bitcoinjs-lib');
var bufferEqual = require('buffer-equal');
var equals = require('equals');
var ECKey = bitcoin.ECKey;

function size(obj) {
  if (Array.isArray(obj)) return obj.length;

  var i = 0;
  for (var p in obj) {
    if (obj.hasOwnProperty(p)) i++;
  }

  return i;
}

taptest('aes encrypt/decrypt', function(t) {
  t.plan(2);

  var buf = crypto.randomBytes(32);
  var key = crypto.randomBytes(32);
  var encrypted = cryptoUtils.encrypt(buf, key);
  var decrypted = cryptoUtils.decrypt(encrypted, key);

  t.ok(!bufferEqual(buf, encrypted));
  t.ok(bufferEqual(buf, decrypted));

  buf = crypto.randomBytes(128);
  // t.ok(bufferEqual(buf, utils.fileToBuf(utils.fileToString(buf))));
});

taptest('ecdh', function(t) {
  t.plan(1);

  var a = ECKey.makeRandom();
  var b = ECKey.makeRandom();

  // var ab = a.pub.Q.multiply(b.d).getEncoded();
  // var ba = b.pub.Q.multiply(a.d).getEncoded();

  var ab = cryptoUtils.sharedEncryptionKey(a.d, b.pub);
  var ba = cryptoUtils.sharedEncryptionKey(b.d, a.pub);

  t.ok(bufferEqual(ab, ba));
});

taptest('transaction data', function(t) {
  t.plan(size(TransactionData.types) * 2);

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

taptest('permission file', function(t) {
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
      t.ok(equals(decryptedPermission.body(), permission.body()));
    });
});

taptest('permission file + transaction construction, reconstruction', function(t) {
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
          t.ok(equals(parsedPermission.body(), permission.body()));
          // #5
          t.ok(bufferEqual(fileHash, parsedPermission.fileKeyBuf()));
          // #6
          t.ok(bufferEqual(fileKey, parsedPermission.decryptionKeyBuf()));
        }, t.fail)
    });
});