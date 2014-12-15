
'use strict';

var test = require('tape');
var cryptoUtils = require('../lib/crypto');
var WalletAppKit = require('../lib/walletAppKit');
var fixtures = require('./fixtures/wallet.json');

test('aes encrypt/decrypt', function(t) {
  t.plan(2);

  var str = 'blahblahoiblah';
  var pass = 'password';
  var encrypted = cryptoUtils.encrypt(str, pass);
  var decrypted = cryptoUtils.decrypt(encrypted, pass);

  t.notEqual(str, encrypted);
  t.equal(str, decrypted);
});