'use strict';

/**
 * Source: https://github.com/hivewallet/hive-js/blob/master/app/lib/denomination/index.js
**/

var bitcoin = {
  default: 'BTC'
}

module.exports = {
  bitcoin: bitcoin,
  testnet: bitcoin,
  litecoin: {
    default: 'LTC'
  }
}