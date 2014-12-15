
'use strict';

var crypto = require('./crypto');

function Permission(fileHash, fileEncryptionKey) {
  this._payload = {
    fileHash: this._fileHash,
    decryptionKey: fileEncryptionKey
  }
}

Permission.prototype.encrypt = function(myPrivKey, theirPubKey) {
  var permissionEncryptionKey = crypto.sharedEncryptionKey(myPrivKey, theirPubKey);

  this._cleartext = JSON.stringify(this._payload);
  this._cipherbuf = crypto.encrypt(this._cleartext, permissionEncryptionKey);
  // this._ciphertext = crypto.keyToString(this._cipherbuf);
}

Permission.prototype.key = function() {
  if (!this._key) 
    this._key = crypto.getStorageKeyFor(this._cipherbuf);

  return this._key;
}

// Permission.prototype.ciphertext = function() {
//   return this._ciphertext;
// }

Permission.prototype.cipherbuf = function() {
  return this._cipherbuf;
}