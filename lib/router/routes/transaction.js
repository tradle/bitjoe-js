
'use strict';

var express = require('express');
var router = express.Router();
var common = require('../../common');
var TransactionRequest = require('../../requests').TransactionRequest;

router.post('/', function(req, res) {
  var app = req.app;
  var joe = app.get('joe');
  var params = req.body;
  var to = common.requireParam(req, 'to').split(',');
  var data = common.requireParam(req, 'data');
  try {
    data = JSON.parse(data)
  } catch (err) {
    throw common.httpError(400, 'data must be valid JSON');
  }

  var cleartext = common.isTruthy(params.cleartext);
  var tReq = new TransactionRequest(joe)
                      .data(data)
                      .recipients(to)
                      .cleartext(cleartext);

  tReq.execute(function(err, resp) {
    if (err) throw common.httpError(err.status || 400, err.message);

    // for (var id in resp.permissions) {
    //   var p = resp.permissions[id];
    //   var tx = joe.wallet().txGraph.findNodeById(p.txId).tx;
    //   joe.getPermissionData(tx);
    // }

    // app.emit('newentry', resp.key, resp.value);
    // for (var pubKey in resp.permissions) {
    //   var p = resp.permissions[pubKey];
    //   app.emit('newpermission', p.body());
    // }

    res.status(200).json(resp);
  });
});

module.exports = router;