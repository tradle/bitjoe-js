
var typeForce = require('typeforce');
var utils = require('tradle-utils');
var bitcoin = require('bitcoinjs-lib');
var debug = require('debug')('dataLoader');
var Q = require('q');
var EventEmitter = require('events').EventEmitter;
var inherits = require('util').inherits;
var uniq = require('uniq');
var TransactionData = require('./transactionData');
var Permission = require('./permission');
var commonBlockchains = require('./commonBlockchains');
var cryptoUtils = require('./crypto');
var FILE_EVENTS = ['file:shared', 'file:public', 'file:permission'];
var noop = function() {};

module.exports = DataLoader;

function DataLoader(options) {
  var self = this;

  typeForce('Object', options);
  typeForce({
    networkName: 'String',
    keeper: 'Object'
  }, options)

  EventEmitter.call(this);

  utils.bindPrototypeFunctions(this);
  this._wallet = options.wallet;
  this._networkName = options.networkName;
  this._network = bitcoin.networks[this._networkName];
  this._prefix = typeof options.prefix === 'undefined' ? 'tradle' : options.prefix;
  this._keeper = options.keeper;

  FILE_EVENTS.forEach(function(event) {
    self.on(event, function(file, key, tx) {
      self.saveIfNew(file, key, tx);
      self.emit('file', file, key, tx);
    });
  })
}

inherits(DataLoader, EventEmitter);

/**
 *  Optimized data loading with minimum calls to keeper
 *  @return {Q.Promise} for files related to the passed in transactions/ids
 **/
DataLoader.prototype.load = function(txIds) {
  var self = this;

  txIds = Array.isArray(txIds) ? txIds : [txIds];
  if (txIds.some(function(t) { return !self.getTransaction(t) })) {
    return this.fetchMissingBodies(txIds)
      .then(this.load);
  }

  var wallet = this._wallet;
  var txs = [];
  var txData = [];
  for (var i = 0; i < txIds.length; i++) {
    var tx = this.getTransaction(txIds[i]);
    var data = tx && this.getTransactionData(tx);
    if (data) {
      txs.push(tx);
      txData.push(data);
    }
  }

  var permissionData = txData.map(noop); // fill with undefineds
  var files = permissionData.slice(); // fill with undefineds
  var keys = txData.map(function(txData, idx) {
    if (!txData) return;

    var key;
    var pData;

    switch (txData.type()) {
      case TransactionData.types.PUBLIC:
        key = txData.data();
        break;
      case TransactionData.types.CLEARTEXT_STORE:
      case TransactionData.types.ENCRYPTED_SHARE:
        if (!wallet) break;

        pData = permissionData[idx] = self.getPermissionData(txIds[idx], txData);
        if (!pData) return;

        key = pData.key;
        break;
    }

    return cryptoUtils.toHumanReadableString(key);
  });

  keys = uniq(compact(keys));

  if (!keys.length) return Q.resolve();

  var idxMap = []; // save indices in {files} we have permissions data for
  var permissions;
  return this.fetchFiles(keys)
    .then(function(results) {
      // fetch any files that required a permission file (a.k.a. intermediate file)
      permissions = txData.reduce(function(memo, txData, i) {
        var data = results[i];
        if (typeof data === 'undefined' || data === null) return memo;

        // console.log('tx:', common.getTransactionUrl(self._networkName, txs[i]));
        var tx = txs[i];
        var pData = permissionData[i];
        var decryptionKey;
        switch (txData.type()) {
          case TransactionData.types.PUBLIC: // we already have our file
            files[i] = getCanonicalFile(data);
            self.emit('file:public', files[i], keys[i], tx);
            // console.log('public: ', JSON.stringify(files[i]))
            return memo;
          case TransactionData.types.ENCRYPTED_SHARE:
            if (typeof pData === 'undefined') return memo;

            decryptionKey = pData.sharedKey;
            /* falls through */
          case TransactionData.types.CLEARTEXT_STORE:
            idxMap.push(i);
            debug('Permission ciphertext: ' + data);
            var permission;
            try {
              permission = Permission.recover(data, decryptionKey);
            } catch (err) {
              debug('Failed to recover permission file contents from raw data', err);
              return memo;
            }

            var body = permission.body();
            // console.log('File permission:', body);
            self.emit('file:permission', body, keys[i], tx);
            memo.push(permission);
            return memo;
          default:
            throw new Error('unsupported type');
        }
      }, []);

      if (permissions.length) {
        self.emit('permissions:downloaded', permissions);
        var sharedFileKeys = permissions.map(function(p) {
          return p.fileKeyString()
        });

        return self.fetchFiles(sharedFileKeys);
      }

      return [];
    })
    .then(function(sharedFiles) {
      // merge permission-based files into files array
      sharedFiles.forEach(function(file, idx) {
        var fileIdx = idxMap[idx];
        var tx = txs[fileIdx];
        var permission = permissions[idx];
        var decryptionKey = permission.decryptionKeyBuf();
        if (decryptionKey) {
          try {
            file = cryptoUtils.decrypt(file, decryptionKey);
          } catch (err) {
            debug('Failed to decrypt ciphertext: ' + file);
            return;
          }
        }

        file = getCanonicalFile(file);
        self.emit('file:shared', file, permission.fileKeyString(), tx);
        files[fileIdx] = file;
      });

      var numFiles = 0;
      var fileInfos = [];
      files.forEach(function(f, i) {
        // console.log('File content:', files[i]);
        fileInfos.push({
          file: f,
          permission: permissions[i],
          tx: txs[i]
        })

        numFiles++;
      });

      if (numFiles) self.emit('files:downloaded', fileInfos);

      return files;
    });
}

DataLoader.prototype.fetchFiles = function(keys) {
  return this._keeper.getMany(keys)
    .catch(function(err) {
      debug('Error fetching files', err);
      throw new Error(err.message || 'Failed to retrieve file from keeper');
    });
}

DataLoader.prototype.getTransactionData = function(tx) {
  tx = this.getTransaction(tx);
  return TransactionData.fromTx(tx, this._prefix);
}

/**
 *  Parses data embedded in tx (in OP_RETURN) and attempts to recover
 *  the necessary ingredients for obtaining the permission file (a.k.a. intermediate file)
 *
 *  @return {
 *    key: <permission key in storage>
 *    sharedKey: <key to decrypt permission body>
 *  }
 */
DataLoader.prototype.getPermissionData = function(tx, txData) {
  txData = txData || this.getTransactionData(tx);
  if (!txData) return;

  var wallet = this._wallet;
  var myAddress;
  var myPrivKey;
  var theirPubKey;
  var toMe = this.getSentToMe(tx);
  var fromMe = this.getSentFromMe(tx);
  if (!toMe.length && !fromMe.length) {
    debug('Cannot parse permission data from transaction as it\'s neither to me nor from me');
    return;
  }

  if (fromMe.length) {
    // can't figure out their public key
    if (toMe.length !== tx.outs.length - 1) {
      debug('Unable to process transaction data, don\'t know the public key of the receipient');
      return;
    }

    tx.ins.some(function(input) {
      var addr = wallet.getAddressFromInput(input);
      myPrivKey = wallet.getPrivateKeyForAddress(addr);
      return myPrivKey;
    });

    toMe.some(function(out) {
      var addr = wallet.getAddressFromOutput(out);
      if (addr && !wallet.isChangeAddress(addr)) {
        theirPubKey = wallet.getPublicKeyForAddress(addr);
        return true;
      }
    });

    // myAddress = common.getAddressFromInput(fromMe[0]);
    // var notToMe = _.difference(tx.outs, toMe);
    // theirAddress = self.getAddressFromOutput(notToMe[0]);
  } else {
    myAddress = wallet.getAddressFromOutput(toMe[0]);
    myPrivKey = wallet.getPrivateKeyForAddress(myAddress);
    theirPubKey = bitcoin.ECPubKey.fromBuffer(tx.ins[0].script.chunks[1]);
  }

  if (!myPrivKey || !theirPubKey) return;

  var sharedKey = cryptoUtils.sharedEncryptionKey(myPrivKey, theirPubKey);
  var permissionKey;
  try {
    permissionKey = cryptoUtils.decrypt(txData.data(), sharedKey);
  } catch (err) {
    debug('Failed to decrypt permission key: ' + txData.data());
    return;
  }

  return {
    key: cryptoUtils.toHumanReadableString(permissionKey),
    sharedKey: sharedKey
  };
}

DataLoader.prototype.saveIfNew = function(file, fileKey, tx) {
  var self = this;

  var wallet = this._wallet;
  if (!wallet) return;

  var metadata = wallet.getMetadata(tx);
  if (!metadata || metadata.confirmations) return;

  var received = !wallet.isSentByMe(tx);
  var type = received ? 'received' : 'sent';
  return this._keeper.put(file)
    .then(function() {
      self.emit('file:' + type, file, fileKey, tx);
    });
}

DataLoader.prototype.getTransaction = function(txId) {
  if (txId.ins && txId.outs) return txId;

  var node = this._wallet && this._wallet.txGraph.findNodeById(txId);
  return node && node.tx;
}

/**
 *  @return {Array} outputs in tx that the underlying wallet can spend
 */
DataLoader.prototype.getSentToMe = function(tx) {
  var wallet = this._wallet;

  return tx.outs.filter(function(out) {
    var address = wallet.getAddressFromOutput(out);
    return wallet.getPrivateKeyForAddress(address) && out;
  });
}

/**
 *  @return {Array} inputs in tx that are signed by the underlying wallet
 */
DataLoader.prototype.getSentFromMe = function(tx) {
  var wallet = this._wallet;

  return tx.ins.filter(function(input) {
    var address = wallet.getAddressFromInput(input);
    return wallet.getPrivateKeyForAddress(address) && input;
  });
}

DataLoader.prototype.fetchMissingBodies = function(txIds) {
  var self = this;
  var missingBodies = txIds.filter(function(t) { return !self.getTransaction(t) });
  return this.fetchTransactions(missingBodies)
    .then(function(txs) {
      var i;
      for (i = 0; i < txs.length; i++) {
        txs[i] = bitcoin.Transaction.fromHex(txs[i].txHex);
      }

      var merged = [];
      for (i = 0; i < txIds.length; i++) {
        var tx = txIds[i];
        if (tx.getId) merged.push(tx);
        else merged.push(txs.shift());
      }

      return merged;
    });
}

DataLoader.prototype.fetchTransactions = function(txIds) {
  var api = commonBlockchains(this._networkName);
  return Q.ninvoke(api.transactions, 'get', txIds);
}

function compact(arr) {
  return arr.filter(function(val) {
    return !!val;
  });
}

function getCanonicalFile(file) {
  if (Buffer.isBuffer(file)) file = file.toString();

  if (typeof file === 'string') {
    try {
      file = JSON.parse(file);
    } catch (err) {
      debug('File is not JSON: ' + file);
    }
  }

  return file;
}
