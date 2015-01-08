
'use strict';

var express = require('express');
var concat = require('concat-stream');
var router = express.Router();
var common = require('../../../common');
var TransactionRequest = require('../../../requests').TransactionRequest;

router.put('/', function(req, res) {
  var app = req.app;
  var joe = app.get('joe');

  req.pipe(concat(function(buf) {
    var data;
    try {
      data = JSON.parse(buf.toString());
    } catch (err) {
      throw common.httpError(400, 'data must be valid JSON');      
    }

    var tReq = new TransactionRequest(joe).data(data);
    var params = req.query;

    if ('to' in params) tReq.recipients(params.to.split(','));
    if ('public' in params) tReq.setPublic(common.isTruthy(params['public']));
    if ('cleartext' in params) tReq.cleartext(common.isTruthy(params.cleartext)); 

    tReq.execute()
      .then(function(resp) {
        res.status(200).json(resp);
      })
      .done();

  }));
});

module.exports = router;