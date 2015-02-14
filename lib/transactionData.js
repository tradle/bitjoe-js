'use strict';

var assert = require('assert');
// var bitcoin = require('bitcoinjs-lib');
var cryptoUtils = require('./crypto');
var common = require('./common');
var debug = require('debug')('transactionData');
var bufferEqual = require('buffer-equal');

TransactionData.types = {
  CLEARTEXT_STORE: 0,
  ENCRYPTED_SHARE: 1,
  PUBLIC: 2
};

function TransactionData(prefix, type, data) {
  assert(
    typeof prefix !== 'undefined' &&
    typeof type !== 'undefined' &&
    typeof data !== 'undefined',
    'prefix, type and data are all required'
  );

  if (values(TransactionData.types).indexOf(type) === -1)
    throw new Error('unsupported transaction data type');

  this._prefix = prefix;
  this._type = type;
  this._data = data;
  debug('DATA in bitcoin tx: ' + data.toString('hex'));
}

TransactionData.prototype.type = function() {
  return this._type;
}

TransactionData.prototype.data = function() {
  return this._data;
}

TransactionData.prototype.serialize = function() {
  var typeBuf = new Buffer(1);
  typeBuf.writeUInt8(this.type(), 0);
  var prefixBuf = new Buffer(this._prefix);
  var dataBuf = cryptoUtils.keyToBuf(this._data);

  return Buffer.concat([
    prefixBuf,
    typeBuf,
    dataBuf
  ], prefixBuf.length + typeBuf.length + dataBuf.length);
}

TransactionData.deserialize = function(buf, prefix) {
  assert(
    typeof buf !== 'undefined' &&
    typeof prefix !== 'undefined',
    'buf and prefix are required'
  );

  var prefixBuf = new Buffer(prefix);
  var prefixLength = prefixBuf.length;
  if (!bufferEqual(buf.slice(0, prefixLength), prefixBuf)) return

  var type = buf[prefixLength];
  var data = buf.slice(prefixLength + 1);
  return new TransactionData(prefix, type, data);
}

TransactionData.fromTx = function(tx, prefix) {
  var data = common.getOpReturnData(tx);
  return data && TransactionData.deserialize(data, prefix);
}

function values(obj) {
  var results = [];
  for (var k in obj) {
    results.push(obj[k]);
  }

  return results
}

module.exports = TransactionData;
