
'use strict';

var commonBlockchains = require('../commonBlockchains');

// function UnspentDiscovery() {}

// UnspentDiscovery.prototype.network = function(network) {
//   this._network = network;
//   return this;
// }

// UnspentDiscovery.prototype.addresses = function(addresses) {
//   this._addresses = [].concat.apply([], arguments);
//   return this;
// }

// UnspentDiscovery.prototype.commonBlockchain = function(commonBlockchain) {
//   this._commonBlockchain = commonBlockchain;
//   return this;
// }

// UnspentDiscovery.prototype.discover = function(cb) {
//   var network = this._network || 'bitcoin';
//   var commonBlockchain = this._commonBlockchain || new Helloblock(network);
//   var addresses = this._addresses;
//   return fetchUnspents({
//     addresses: addresses,
//     commonBlockchain: commonBlockchain
//   }, cb);
// }

function fetchUnspents(networkName, addresses, cb) {
  commonBlockchains(networkName).addresses.unspents(addresses, function(err, results) {
    if (err) return cb(err);

    cb(null, results);
  });
}

module.exports = fetchUnspents;