
'use strict';

var express = require('express');
var router = express.Router();
var common = require('../../common');

router.post('/', function(req, res) {
  var joe = req.app.get('joe');
  var params = req.body;

  if (!joe.kit().getBalance()) throw common.httpError(400, 'Insufficient funds');

  var value = ('amount' in params) ? parseInt(params.amount) : null;

  joe.kit().refundToFaucet(value, function(err, value) {
    if (err) throw common.httpError(err.status || 400, err.message);

    res.status(200).json({
      refunded: value
    });
  });
});

module.exports = router;