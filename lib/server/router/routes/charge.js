
'use strict';

var express = require('express');
var router = express.Router();
var common = require('../../../common');
var debug = require('debug')('bitjoe-recharge');
var bodyParser = require('body-parser');

router.use(bodyParser.urlencoded({ extended: true })); // for parsing application/x-www-form-urlencoded
router.post('/', function(req, res) {
  var joe = req.app.get('joe');
  var value = Number(common.requireParam(req, 'amount'));

  joe.withdrawFromFaucet(value)
    .then(joe.sync)
    .then(function () {
      debugger;
      debug('Charged', value);
      
      res.status(200).json({
        charged: value
      });
    });
});

module.exports = router;