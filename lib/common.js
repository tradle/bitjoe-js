
'use strict';

var bitcoin = require('bitcoinjs-lib');
var crypto = require('crypto');
var fs = require('fs');

var Common = {
  permissionCost: function(network) {
    return bitcoin.networks[network].dustThreshold;
  },

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

  toBase58: function(data) {
    throw new Error('not implemented');
  },


  isTruthy: function(val) {
    if (val instanceof Number) return !!val;
    
    return val !== '0' && val !== 'false';
  },

  proxyFunctions: function(proxy, source) {
    for (var p in source) {
      if (!proxy[p] && typeof source[p] === 'function')
        proxy[p] = source[p].bind(source);
    }    
  },

  toBuffer: function(bufOrStr) {
    return bufOrStr instanceof Buffer ? bufOrStr : new Buffer(bufOrStr);
  },


  requireOption: function(options, option) {
    if (!(option in options)) throw new Error('Missing required option: ' + option);

    return options[option];
  },

  pushUniq: function(a, b) {
    for (var i = 0; i < b.length; i++) {
      if (a.indexOf(b[i]) === -1)
        a.push(b[i]);
    }
  },

  safeWrite: function(path, content, callback) {
    var tmpPath = path + '.' + crypto.randomBytes(128) + '.tmp';
    fs.writeFile(tmpPath, content, function(err) {
      if (err) return callback(err);

      fs.rename(tmpPath, path, function(err) {
        if (err) return callback(err);

        callback();
      })
    });
  }
}

module.exports = Common;