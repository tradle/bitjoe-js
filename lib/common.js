
'use strict';

var crypto = require('crypto');
var algorithm = 'aes-256-gcm';
var CIPHERTEXT_ENCODING = 'base64';
var KEY_ENCODING = 'base64';
// var iv = 'o0Q5H1ODEbMpVIYWxIlyPg';

var Common = {
  httpError: function(code, msg) {
    var err = new Error(msg);
    err.code = code;
    return err;
  },

  asyncify: function(callback) {
    return function() {
      var self = this;
      var args = arguments;

      process.nextTick(function() {
        callback.apply(self, args);
      });
    }
  },

  ciphertextToString: function(ciphertextBuffer) {
    return ciphertextBuffer.toString(CIPHERTEXT_ENCODING);
  },

  ciphertextToBuf: function(ciphertext) {
    return new Buffer(ciphertext, CIPHERTEXT_ENCODING);
  },

  keyToString: function(keyBuffer) {
    return keyBuffer.toString(KEY_ENCODING);
  },

  keyToBuf: function(key) {
    return new Buffer(key, KEY_ENCODING);
  },

  getStorageKeyFor: function(data) {
    return Common.toBase58(
      crypto.createHash('sha256').update(data).digest('hex')
    );
  },

  encrypt: function(text, key) {
    var cipher = crypto.createCipher(algorithm, key);
    var crypted = cipher.update(text,'utf8','hex');
    crypted += cipher.final('hex');
    return crypted;
  },
   
  decrypt: function(text, key) {
    var decipher = crypto.createDecipher(algorithm, key);
    var dec = decipher.update(text, 'hex', 'utf8');
    dec += decipher.final('utf8');
    return dec;
  }

  // encrypt: function(text, key) {
  //   var cipher = crypto.createCipheriv(algorithm, key, iv);
  //   var encrypted = cipher.update(text, 'utf8', 'hex');
  //   encrypted += cipher.final('hex');
  //   var tag = cipher.getAuthTag();
  //   return {
  //     content: encrypted,
  //     tag: tag
  //   };
  // },
   
  // decrypt: function(encrypted, key, iv) {
  //   var decipher = crypto.createDecipheriv(algorithm, key, iv);
  //   decipher.setAuthTag(encrypted.tag);
  //   var dec = decipher.update(encrypted.content, 'hex', 'utf8');
  //   dec += decipher.final('utf8');
  //   return dec;
  // }

}

module.exports = Common;