
'use strict';

var Joe = require('./');
var joe = new Joe();
joe.on('ready', function() {
  console.log('Send coins to ' + joe.currentReceiveAddress());
  console.log('Balance: ' + joe.wallet().getBalance());
});