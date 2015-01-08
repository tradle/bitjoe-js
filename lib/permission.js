
'use strict';

var cryptoUtils = require('./crypto');
var assert = require('assert');

function Permission(key, symmetricKey) {
  var symmetricKeyStr;

  if (typeof symmetricKey === 'undefined' || symmetricKey === null)
    symmetricKeyStr = null;
  else if (typeof symmetricKey !== 'string')
    symmetricKeyStr = cryptoUtils.keyToString(symmetricKey);
  else
    symmetricKeyStr = symmetricKey;

  var keyStr = typeof key === 'string' ? 
          key : 
          cryptoUtils.toHumanReadableString(key);

  this._body = {
    key: keyStr,
    decryptionKey: symmetricKeyStr
  }

  this._cleartext = new Buffer(JSON.stringify(this._body));
}

Permission.prototype.encrypt = function(encryptionKey) {
  this._encryptionKey = encryptionKey;
  this._encryptBody = true;
  this._encryptKey = true;
}

Permission.prototype.encryptKey = function(encryptionKey) {
  this._encryptionKey = encryptionKey;
  this._encryptKey = true;
}

Permission.prototype.build = function() {
  var self = this;

  return cryptoUtils.getStorageKeyFor(this._cleartext)
    .then(function(key) {
      if (self._encryptBody) {
        self._cipherbuf = cryptoUtils.encrypt(self._cleartext, self._encryptionKey);
        return cryptoUtils.getStorageKeyFor(self._cipherbuf);
      }

      return key;
    })
    .then(function(key) {
      self._key = key;
      if (self._encryptKey) {
        self._encryptedKey = cryptoUtils.encrypt(self._key, self._encryptionKey);
      }
    });
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
  return this._body.decryptionKey;
}

Permission.prototype.decryptionKeyBuf = function() {
  var dKey = this._body.decryptionKey;
  if (dKey === null) return dKey;

  return  cryptoUtils.keyToBuf(dKey);
}

// Permission.decryptKey = function(myPrivKey, theirPubKey, encryptedKey) {
//   var permissionEncryptionKey = cryptoUtils.sharedEncryptionKey(myPrivKey, theirPubKey);
//   return cryptoUtils.decrypt(encryptedKey, permissionEncryptionKey);
// }

Permission.recover = function(data, encryptionKey) {
  if (typeof data === 'string') 
    data = cryptoUtils.fileToBuf(data);

  // var permissionEncryptionKey = cryptoUtils.sharedEncryptionKey(myPrivKey, theirPubKey);
  if (encryptionKey)
    data = cryptoUtils.decrypt(data, encryptionKey);

  var json = data.toString();
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