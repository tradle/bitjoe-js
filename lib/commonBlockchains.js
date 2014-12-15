
'use strict';

var Blockchain = require('cb-helloblock');

var commonBlockchains = {};

module.exports = function(networkName) {
  if (!commonBlockchains[networkName]) 
    commonBlockchains[networkName] = new Blockchain(networkName);

  return commonBlockchains[networkName]; 
}