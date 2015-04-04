/* @flow */

var typeForce = require('typeforce');
var utils = require('tradle-utils');
var debug = require('debug')('dataLoader');
var EventEmitter = require('events').EventEmitter;
var inherits = require('util').inherits;
var Permission = require('./permission');
var cryptoUtils = require('./crypto');
var pluck = require('array-pluck');
var TxParser = require('./txParser');
var extend = require('extend');
var FILE_EVENTS = ['file:shared', 'file:public', 'file:permission'];

module.exports = DataLoader;

function DataLoader(options) {
  var self = this;

  typeForce({
    keeper: 'Object'
  }, options)

  EventEmitter.call(this);
  utils.bindPrototypeFunctions(this);

  this._options = extend({}, options);
  this._keeper = options.keeper;
  this._txParser = new TxParser(options);

  FILE_EVENTS.forEach(function(event) {
    self.on(event, function(data) {
      self.saveIfNew(data);
      self.emit('file', data);
    });
  });
}

inherits(DataLoader, EventEmitter);

/**
 *  Optimized data loading with minimum calls to keeper
 *  @return {Q.Promise} for files related to the passed in transactions/ids
 **/
DataLoader.prototype.load = function(txs) {
  var self = this;
  if (!Array.isArray(txs)) txs = [txs];

  var pub = [];
  var enc = [];
  txs.forEach(function(tx) {
    var parsed = this._txParser.parse(tx);
    if (parsed) {
      var group = parsed.type === 'public' ? pub : enc;
      group.push(parsed);
    }
  }, this);

  if (!(pub.length || enc.length)) return;

  var shared;
  var keys = pluck(pub, 'key').concat(pluck(enc, 'key'));
  return this.fetchFiles(keys)
    .then(function(files) {
      pub.forEach(function(parsed, i) {
        if (files[i]) {
          parsed.file = getCanonicalFile(files[i]);
          self.emit('file:public', parsed);
        }
      });

      if (!enc.length) return;

      shared = enc.filter(function(parsed, i) {
        var file = files[i + pub.length];
        if (!file) return;

        var decryptionKey = parsed.sharedKey;
        try {
          parsed.permission = Permission.recover(file, decryptionKey);
        } catch (err) {
          debug('Failed to recover permission file contents from raw data', err);
          return;
        }

        self.emit('file:permission', parsed);
        return parsed;
      });

      if (!shared.length) return;

      return self.fetchFiles(pluck(shared, 'key'));
    })
    .then(function(sharedFiles) {
      if (!sharedFiles) return;

      sharedFiles.forEach(function(file, idx) {
        var parsed = extend({}, shared[idx]);
        var pKey = parsed.key;
        parsed.permissionKey = pKey;
        parsed.key = parsed.permission.fileKeyString();

        var decryptionKey = parsed.permission.decryptionKeyBuf();
        if (decryptionKey) {
          try {
            file = cryptoUtils.decrypt(file, decryptionKey);
          } catch (err) {
            debug('Failed to decrypt ciphertext: ' + file);
            return;
          }
        }

        parsed.file = getCanonicalFile(file);
        self.emit('file:shared', parsed);
      })
    });
}

DataLoader.prototype.fetchFiles = function(keys) {
  return this._keeper.getMany(keys)
    .catch(function(err) {
      debug('Error fetching files', err);
      throw new Error(err.message || 'Failed to retrieve file from keeper');
    });
}

DataLoader.prototype.saveIfNew = function(data) {
  var self = this;

  var wallet = this._options.wallet;
  if (!wallet) return;

  var tx = data.tx.body;
  var metadata = data.tx.metadata;
  if (!metadata || metadata.confirmations) return;

  var received = !wallet.isSentByMe(tx);
  var type = received ? 'received' : 'sent';
  return this._keeper.put(data.file.body)
    .then(function() {
      self.emit('file:' + type, data);
    });
}

function getCanonicalFile(file) {
  if (Buffer.isBuffer(file)) file = file.toString();

  if (typeof file === 'string') {
    try {
      file = JSON.parse(file);
    } catch (err) {
      debug('File is not JSON: ' + file);
    }
  }

  return file;
}
