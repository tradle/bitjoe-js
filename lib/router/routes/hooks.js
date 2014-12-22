
'use strict';

var express = require('express');
var router = express.Router();
var common = require('../../common');
var pubsub = require('../../pubsub');

router.post('/', function(req, res) {
  var event = common.requireParam(req, 'event');
  var url = common.requireParam(req, 'url');
  pubsub.emit('hooks:add', event, url);
  res.status(200);
});

module.exports = router;