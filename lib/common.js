
'use strict';

var bitcoin = require('bitcoinjs-lib');
var crypto = require('crypto');
var fs = require('fs');

var Common = {
  prefix: 'tradle',
  permissionCost: function(network) {
    return bitcoin.networks[network].dustThreshold;
  },

  httpError: function(statusCode, msg) {
    var err = new Error(msg);
    err.status = statusCode;
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
    if (typeof val === 'undefined' || val === null || val === false) return false;
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

  requireOptions: function(options /*, option1, option2... */) {
    [].slice.call(arguments, 1).map(function(arg) {
      Common.requireOption(options, arg);
    });
  },


  pushUniq: function(a, b) {
    for (var i = 0; i < b.length; i++) {
      if (a.indexOf(b[i]) === -1)
        a.push(b[i]);
    }
  },

  safeWrite: function(options, callback) {
    var path = Common.requireOption(options, 'path');
    var data = Common.requireOption(options, 'data');
    var encoding = options.encoding || 'utf8';
    var tmpPath = path + '.' + crypto.randomBytes(8).toString('hex') + '.tmp';
    fs.writeFile(tmpPath, data, { encoding: encoding }, function(err) {
      if (err) return callback(err);

      fs.rename(tmpPath, path, function(err) {
        if (err) return callback(err);

        callback();
      })
    });
  }
}

module.exports = Common;