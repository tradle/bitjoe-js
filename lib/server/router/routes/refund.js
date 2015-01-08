
'use strict';

var express = require('express');
var router = express.Router();
var common = require('../../../common');
var log = console.log.bind(console);
var bodyParser = require('body-parser');

router.use(bodyParser.urlencoded({ extended: true })); // for parsing application/x-www-form-urlencoded
router.post('/', function(req, res) {
  var joe = req.app.get('joe');
  var params = req.body;

  if (!joe.getBalance()) throw common.httpError(400, 'Insufficient funds');

  var value = ('amount' in params) ? parseInt(params.amount) : null;

  joe.refundToFaucet(value).done(function(value) {
    log('Refunded', value);
    
    res.status(200).json({
      refunded: value
    });
  });
});

module.exports = router;