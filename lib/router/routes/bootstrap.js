
'use strict';

var express = require('express');
var router = express.Router();
var common = require('../../common');
var async = require('async');

router.post('/', function(req, res) {
  // throw common.httpError(501, 'Not supported');
  debugger;

  var joe = req.app.get('joe');
  var txs = joe.getDataTransactions();

  if (!txs.length) return res.status(200).json([]);

  joe.fetchPermissions(txs, function(err, permissions) {
    if (err) throw common.httpError(err.status || 500, err.message);

    var tasks = permissions.map(function(permission) {
      return function(cb) {
        return joe.loadFile(permission, cb);
      }
    });

    async.parallel(tasks, function(err, files) {
      if (err) throw common.httpError(err.status || 500, err.message);

      console.log(common.prettify(files));
      res.status(200).send('');
    });
  });

  // async.parallel(tasks, function(err, results) {
  //   res.status(200).json(results);
  // })
});

module.exports = router;