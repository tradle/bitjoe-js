
'use strict';

var bitcoin = require('bitcoinjs-lib');
var crypto = require('crypto');
var fs = require('fs');
var Wallet = require('cb-wallet');

Array.prototype.remove = function(value) {
  var idx = this.indexOf(value);
  if (idx !== -1) return this.splice(idx, 1); // The second parameter is the number of elements to remove.
  
  return false;
}

var Common = {
  prefix: 'tradle',
  permissionCost: function(network) {
    return bitcoin.networks[network].dustThreshold + 1;
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

  toBuffer: function(str, encoding) {
    if (str instanceof Buffer) return str;

    return new Buffer(str, encoding || 'binary');
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

  bindPrototypeFunctions: function(obj) {
    // bind all prototype functions to self  
    var proto = obj.constructor.prototype;
    for (var p in proto) {
      var val = proto[p];
      if (typeof val === 'function')
        obj[p] = obj[p].bind(obj);
    }
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
    var fileOptions = options.options || { encoding: 'utf8' };
    var tmpPath = path + '.' + crypto.randomBytes(8).toString('hex') + '.tmp';
    fs.writeFile(tmpPath, data, fileOptions, function(err) {
      if (err) return callback(err);

      fs.rename(tmpPath, path, function(err) {
        if (err) return callback(err);

        callback();
      })
    });
  },

  requireParam: function(req, param) {
    var params = req.method === 'POST' ? req.body : req.query;

    if (!(param in params)) throw Common.httpError(400, 'Missing required parameter: ' + param);

    return params[param];
  },

  getAddressFromInput: function(input, network) {
    if (bitcoin.scripts.classifyInput(input.script) === 'pubkeyhash')
      return bitcoin.ECPubKey.fromBuffer(input.script.chunks[1]).getAddress(network).toString();
  },

  getAddressFromOutput: function(out, network) {
    if (bitcoin.scripts.classifyOutput(out.script) === 'pubkeyhash')
      return bitcoin.Address.fromOutputScript(out.script, network).toString();
  },

  walletFromJSON: function(json) {
    return Wallet.deserialize(json);
  },

  prettify: function(pojo) {
    return JSON.stringify(pojo, null, 2);
  },

  getOpReturnData: function(tx) {
    for (var i = 0; i < tx.outs.length; i++) {
      var out = tx.outs[i];
      if (bitcoin.scripts.isNullDataOutput(out.script))
        return out.script.chunks[1];
    }
  }
}

module.exports = Common;