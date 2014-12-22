
'use strict';

var test = require('tape');
var cryptoUtils = require('../lib/crypto');
var crypto = require('crypto');
var TransactionData = require('../lib/transactionData');
var Permission = require('../lib/permission');
// var WalletAppKit = require('../lib/walletAppKit');
// var fixtures = require('./fixtures/wallet.json');
var bitcoin = require('bitcoinjs-lib');
var _ = require('lodash');
var bufferEqual = require('buffer-equal');
// var cbWalletJson = JSON.stringify(require('./fixtures/cb-wallet'));
// var Wallet = require('cb-wallet');
var ECKey = bitcoin.ECKey;
// var testnet = bitcoin.networks.testnet;
// var blockchain = new (require('cb-helloblock'))('testnet');

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
  t.plan(5);

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
  t.ok(bufferEqual(buf, cryptoUtils.fileToBuf(cryptoUtils.fileToString(buf))));
});

test('ecdh', function(t) {
  t.plan(1);

  var a = ECKey.makeRandom();
  var b = ECKey.makeRandom();

  // var ab = a.pub.Q.multiply(b.d).getEncoded();
  // var ba = b.pub.Q.multiply(a.d).getEncoded();

  var ab = cryptoUtils.sharedEncryptionKey(a.d, b.pub);
  var ba = cryptoUtils.sharedEncryptionKey(b.d, a.pub);

  t.equal(ab, ba);
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
  t.plan(1);

  var key1 = ECKey.makeRandom();
  var key2 = ECKey.makeRandom();

  var fileHash = crypto.randomBytes(40);
  var fileKey = crypto.randomBytes(32);

  var permission = new Permission(fileHash, fileKey);
  permission.encrypt(key1.d, key2.pub);

  var encryptedPermission = permission.data();
  var decryptedPermission = Permission.decrypt(key2.d, key1.pub, encryptedPermission);
  t.ok(_.isEqual(decryptedPermission.body(), permission.body()));
});

test('permission file + transaction construction, reconstruction', function(t) {
  t.plan(7);

  var prefix = 'blah';
  var key1 = ECKey.makeRandom();
  var key2 = ECKey.makeRandom();

  var fileHash = crypto.randomBytes(40);
  var fileKey = crypto.randomBytes(32);

  var permission = new Permission(fileHash, fileKey);
  permission.encrypt(key1.d, key2.pub);

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
  t.ok(bufferEqual(permission.key(), Permission.decryptKey(key2.d, key1.pub, encryptedPermissionKey)));

  var permissionData = permission.data();
  var permissionDataStr = cryptoUtils.fileToString(permissionData);
  var decodedPermissionData = cryptoUtils.fileToBuf(permissionDataStr);

  // #4
  t.ok(bufferEqual(permissionData, decodedPermissionData));
  var parsedPermission = Permission.decrypt(key2.d, key1.pub, decodedPermissionData);

  // #4
  t.ok(_.isEqual(parsedPermission.body(), permission.body()));
  // #5
  t.ok(bufferEqual(fileHash, parsedPermission.fileKeyBuf()));
  // #6
  t.ok(bufferEqual(fileKey, parsedPermission.decryptionKeyBuf()));
});

// test('can create an OP_RETURN transaction', function(t) {
//   t.plan(6);

//   var timeoutId = setTimeout(t.fail, 20000);
//   var key = bitcoin.ECKey.fromWIF("L1uyy5qTuGrVXrmrsvHWHgVzW9kKdrp27wBC7Vs6nZDTF2BRUVwy")
//   var address = key.pub.getAddress(bitcoin.networks.testnet).toString()

//   blockchain.addresses.__faucetWithdraw(address, 2e4, function(err) {
//     t.error(err)

//     blockchain.addresses.unspents(address, function(err, unspents) {
//       t.error(err)

//       // filter small unspents
//       unspents = unspents.filter(function(unspent) { return unspent.value > 1e4 })

//       // use the oldest unspent
//       var unspent = unspents.pop()

//       // var txb = new bitcoin.TransactionBuilder()
//       var data = new Buffer('cafedeadbeef', 'hex')
//       var dataScript = bitcoin.scripts.nullDataOutput(data)

//       debugger;
//       var tx = new bitcoin.Transaction();
//       tx.addInput(unspent.txId, unspent.vout);
//       tx.sign(0, key);

//       tx.addOutput(dataScript, 0);
//       tx.addOutput(address, unspent.value - 2000);
//       // txb.addInput(unspent.txId, unspent.vout)
//       // txb.addOutput(dataScript, 1000)
//       // txb.sign(0, key)

//       blockchain.transactions.propagate(tx.toHex(), function(err) {
//         t.error(err)

//         // check that the message was propagated
//         blockchain.addresses.transactions(address, function(err, transactions) {
//           t.error(err)

//           clearTimeout(timeoutId);
//           var transaction = bitcoin.Transaction.fromHex(transactions[0].txHex)
//           var dataScript2 = transaction.outs[0].script
//           var data2 = dataScript2.chunks[1]

//           t.deepEqual(dataScript, dataScript2)
//           t.deepEqual(data, data2)
//         })
//       })
//     })
//   })
// })
