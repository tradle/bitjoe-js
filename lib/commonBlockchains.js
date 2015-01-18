'use strict';

var Blockchain = require('cb-helloblock');
var assert = require('assert');

var commonBlockchains = {};

module.exports = function (networkName) {
  assert(networkName, 'networkName is required');
  if (!commonBlockchains[networkName])
    commonBlockchains[networkName] = new Blockchain(networkName);

  return commonBlockchains[networkName];
}
