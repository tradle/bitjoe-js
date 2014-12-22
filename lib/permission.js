
'use strict';

var cryptoUtils = require('./crypto');
var assert = require('assert');

function Permission(key, symmetricKey) {
  var symmetricKeyStr = typeof symmetricKey === 'string' ? 
          symmetricKey : 
          cryptoUtils.keyToString(symmetricKey);

  var keyStr = typeof key === 'string' ? 
          key : 
          cryptoUtils.toHumanReadableString(key);

  this._body = {
    key: keyStr,
    decryptionKey: symmetricKeyStr
  }

  console.log('Symmetric key buf: ' + symmetricKey);
  console.log('Symmetric key: ' + symmetricKeyStr);
  this._cleartext = new Buffer(JSON.stringify(this._body));
  this._key = cryptoUtils.getStorageKeyFor(this._cleartext);
}

Permission.prototype.encrypt = function(myPrivKey, theirPubKey) {
  var permissionEncryptionKey = cryptoUtils.sharedEncryptionKey(myPrivKey, theirPubKey);
  this._cipherbuf = cryptoUtils.encrypt(this._cleartext, permissionEncryptionKey);

  this._key = cryptoUtils.getStorageKeyFor(this._cipherbuf);
  this._encryptedKey = cryptoUtils.encrypt(this._key, permissionEncryptionKey);
  console.log('Shared encryption key: ' + cryptoUtils.keyToString(permissionEncryptionKey));
  console.log('Permission key: ' + cryptoUtils.toHumanReadableString(this._key));
  console.log('Encrypted permission key: ' + cryptoUtils.keyToString(this._encryptedKey));
}

Permission.prototype.key = function() {
  return this._key;
}

Permission.prototype.encryptedKey = function() {
  return this._encryptedKey;
}

Permission.prototype.data = function() {
  return this._cipherbuf || this._cleartext;
}

Permission.prototype.body = function() {
  var copy = {};
  for (var p in this._body) {
    copy[p] = this._body[p];
  }

  return copy;
}

Permission.prototype.fileKeyString = function() {
  return cryptoUtils.toHumanReadableString(this._body.key);
}

Permission.prototype.fileKeyBuf = function() {
  return cryptoUtils.fromHumanReadableString(this._body.key);
}

Permission.prototype.decryptionKeyString = function() {
  return cryptoUtils.keyToString(this._body.decryptionKey);
}

Permission.prototype.decryptionKeyBuf = function() {
  return cryptoUtils.keyToBuf(this._body.decryptionKey);
}

Permission.decryptKey = function(myPrivKey, theirPubKey, encryptedKey) {
  var permissionEncryptionKey = cryptoUtils.sharedEncryptionKey(myPrivKey, theirPubKey);
  return cryptoUtils.decrypt(encryptedKey, permissionEncryptionKey);
}

Permission.decrypt = function(myPrivKey, theirPubKey, encryptedData) {
  if (typeof encryptedData === 'string') 
    encryptedData = cryptoUtils.fileToBuf(encryptedData);

  var permissionEncryptionKey = cryptoUtils.sharedEncryptionKey(myPrivKey, theirPubKey);
  var json = cryptoUtils.decrypt(encryptedData, permissionEncryptionKey).toString();
  var body;
  try {
    body = JSON.parse(json);
  } catch (err) {
    throw new Error('Permission body is not valid json');
  }

  assert('key' in body && 'decryptionKey' in body, 'Invalid permission contents');
  return new Permission(body.key, body.decryptionKey);
}

module.exports = Permission;