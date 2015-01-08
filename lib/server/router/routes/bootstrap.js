
'use strict';

var express = require('express');
var router = express.Router();
var common = require('../../../common');
var debug = require('debug')('bitjoe-bootstrap');
var bodyParser = require('body-parser');

router.use(bodyParser.urlencoded({ extended: true })); // for parsing application/x-www-form-urlencoded
router.post('/', function(req, res) {
  var tail = req.body.tail;
  var joe = req.app.get('joe');
  var txs = joe.getDataTransactions();

  if (!txs.length) return res.status(200).json([]);

  // test
  // txs = txs.slice(txs.length - 1);
  // test

  if (typeof tail !== 'undefined') txs = txs.slice(0, Number(tail)); // first ones occurred last

  joe.loadData(txs)
    .done(function(files) {
      debug(common.prettify(files));
      res.status(200).end();
    })

  // joe.fetchPermissions(txs, function(err, permissions) {
  //   if (err) throw common.httpError(err.status || 500, err.message);

  //   var tasks = permissions.map(function(permission) {
  //     return function(cb) {
  //       return joe.loadFile(permission, cb);
  //     }
  //   });

  //   async.parallel(tasks, function(err, files) {
  //     if (err) throw common.httpError(err.status || 500, err.message);

  //     console.log(common.prettify(files));
  //     res.status(200).send('');
  //   });
  // });
});

module.exports = router;