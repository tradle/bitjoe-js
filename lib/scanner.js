
var once = require('once');
var TxWalker = require('tx-walker');
var EventEmitter = require('events').EventEmitter;
var typeForce = require('typeforce');
var Q = require('q');
var DataLoader = require('./dataLoader');
var reemit = require('re-emitter');
var inherits = require('util').inherits;
var noop = function() {};

module.exports = Scanner;

function Scanner(options) {
  EventEmitter.call(this);

  typeForce('Object', options);
  typeForce({
    keeper: 'Object',
    prefix: 'String',
    networkName: 'String'
  }, options);

  this._loader = options.loader || new DataLoader(options);
  this._networkName = options.networkName;

  reemit(this._loader, this, [
    'file',
    'file:public',
    'file:permission',
    'file:shared'
  ]);
}

inherits(Scanner, EventEmitter);

Scanner.prototype.from = function(height) {
  typeForce('Number', height);
  this._fromHeight = height;
  return this;
}

Scanner.prototype.to = function(height) {
  typeForce('Number', height);
  this._toHeight = height;
  return this;
}

Scanner.prototype.scan = function(cb) {
  var self = this;

  if (!this._fromHeight) throw new Error('call "from(height)" before calling scan()');

  this._walker = new TxWalker({
    networkName: this._networkName
  });

  cb = once(cb || noop);
  var walker = this._walker;
  var txs = [];
  var loadingPromises = [];
  var err;

  walker.on('blockstart', function(block, height) {
    txs = [];
  });

  walker.on('blockend', function(block, height) {
    loadingPromises.push(self._loader.load(txs));
    if (height === self._toHeight) walker.stop();
  });

  walker.on('OP_RETURN', function(tx, data) {
    txs.push(tx);
  });

  walker.on('error', function(_err) {
    err = _err;
  });

  walker.on('stop', function() {
    Q.allSettled(loadingPromises, function() {
      cb(err)
    })
  });

  walker.start(this._fromHeight);
  return this;
}

Scanner.prototype.stop = function() {
  this._walker.stop();
  return this;
}
