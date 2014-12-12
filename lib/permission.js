
'use strict';

var common = require('./common');

function Permission(fileHash, encryptionKey) {
  this._fileHash = fileHash;
  this._symmetricKey = encryptionKey;
}

Permission.prototype.encrypt = function() {
  this._ciphertext = null;
  this._hash = null;
  this._cipherbytes = common.encrypt(this._fileHash, this._symmetricKey);
  this._ciphertext = common.cipherbytesToString();
}

Permission.prototype.toJSON = function() {
  return {
    fileHash: this._fileHash,
    decryptionKey: this._symmetricKey
  }
}

Permission.prototype.hash = function() {
  return common.getStorageKeyFor(this._ciphertext);
}

Permission.prototype.hashBytes = function() {
  return common.keyToString(this.hash());
}