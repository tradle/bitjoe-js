
'use strict';

var express = require('express');
var router = express.Router();
var common = require('../../common');

router.post('/', function(req, res) {
  throw common.httpError(501, 'Not supported');
});

module.exports = router;