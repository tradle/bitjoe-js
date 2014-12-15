
'use strict';

/**
 * Source: https://github.com/hivewallet/hive-js/blob/master/app/lib/wallet/db.js
**/

var Datastore = require('nedb')
var credentials = 'credentials';
var PENDING_TX = 'pendingTxs';

function Database(filePath) {
  this._filePath = filePath;
  this._db = new Datastore({
    filename: filePath,
    autoload: true
  });
}

Database.prototype.saveEncryptedSeed = function(id, encryptedSeed, callback) {
  var doc = {
    _id: credentials,
    id: id,
    seed: encryptedSeed
  };

  this._db.update({ _id: credentials }, doc, { upsert: true }, callback);
}

Database.prototype.getCredentials = function(callback) {
  this._db.findOne({ _id: credentials }, callback);
}

Database.prototype.deleteCredentials = function(doc, callback) {
  this._db.remove(doc, function(err){
    if (err) console.error('failed to delete credentials');
    return callback(err);
  })
}

Database.prototype.getPendingTxs = function(callback){
  this._db.findOne({ _id: PENDING_TX }, function(err, doc){
    if (err) return callback(err);

    callback(null, doc ? doc.txs : []);
  })
}

Database.prototype.setPendingTxs = function(txs, callback) {
  var query ={ 
    _id: PENDING_TX 
  };

  var update = { 
    $set: { 
      txs: txs
    } 
  };

  this._db.update(query, update, { upsert: true }, callback);
}

Database.prototype.addPendingTx = function(tx, callback) {
  var query ={ 
    _id: PENDING_TX 
  };

  var update = { 
    $push: { 
      txs: tx
    } 
  };

  this._db.update(query, update, { upsert: true }, callback);
}

Database.prototype.savePendingTx = function(tx, callback) {
  this.addPendingTx(tx, callback);
}

module.exports = Database;

// module.exports = {
//   saveEncryptedSeed: saveEncryptedSeed,
//   getCredentials: getCredentials,
//   deleteCredentials: deleteCredentials,
//   getPendingTxs: getPendingTxs,
//   setPendingTxs: setPendingTxs,
//   addPendingTx: addPendingTx
// }
