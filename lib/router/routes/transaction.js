
'use strict';

var express = require('express');
var router = express.Router();
var common = require('../../common');
var TransactionRequest = require('../../requests').TransactionRequest;

router.post('/', function(req, res) {
  var joe = req.app.get('joe');
  var params = req.body;
  var to = requireParam(params, 'to').split(',');
  var data = requireParam(params, 'data');
  try {
    data = JSON.parse(data)
  } catch (err) {
    throw common.httpError(400, 'data must be valid JSON');
  }

  var cleartext = common.isTruthy(params.cleartext);
  var tReq = new TransactionRequest(joe.kit())
                      .data(data)
                      .recipients(to)
                      .cleartext(cleartext);

  tReq.execute(function(err, resp) {
    if (err) throw common.httpError(err.status || 400, err.message);

    res.status(200).json(resp);
  });
});

function requireParam(params, param) {
  if (!(param in params)) throw common.httpError(400, 'Missing required parameter: ' + param);

  return params[param];
}

module.exports = router;