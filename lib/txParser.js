
var cryptoUtils = require('./crypto');
var common = require('./common');
var extend = require('extend');
var find = require('array-find');
var debug = require('debug')('TxParser');
var bitcoin = require('bitcoinjs-lib');
var TransactionData = require('./transactionData');
var DATA_TYPES = TransactionData.types;

function TxParser(options) {
  extend(this, options);
}

TxParser.prototype.parse = function(tx) {
  var txData = TransactionData.fromTx(tx, this.prefix);
  if (!txData) return;

  // identities
  var me = this.identity;
  var from;
  var to;
  var priv;
  var pub;
  var sharedKey;
  if (this.addressBook) {
    find(tx.ins, function(i) {
      var addr = common.getAddressFromInput(i, this.networkName);
      from = this.addressBook.byAddress(addr);
      return from;
    }, this);

    find(tx.outs, function(o) {
      var addr = common.getAddressFromOutput(o, this.networkName);
      to = this.addressBook.byAddress(addr);
      return to;
    }, this);
  }

  var fileKey = txData.data();
  if (txData.type() === DATA_TYPES.public) {
    return {
      type: 'public',
      key: cryptoUtils.toHumanReadableString(fileKey),
      from: from,
      to: to,
      tx: tx
    }

    return;
  }

  if (me && from && to) {
    if (me === from.identity || me === to.identity) {
      priv = me === from.identity ? from.key.priv() : to.key.priv();
      pub = me === from.identity ? to.key.pub() : from.key.pub();
    }
  }

  if (!(priv && pub)) {
    // priv = ...
    // pub = ...
    // TODO: fall back to decrypting based on bitcoin keys associated with this tx
    var keys = this.deduceECDHKeys(tx, txData);
    if (!keys) return;

    pub = keys.pub;
    priv = keys.priv;
  }

  if (!(pub && priv)) return;

  sharedKey = cryptoUtils.sharedEncryptionKey(priv, pub);
  try {
    fileKey = cryptoUtils.decrypt(fileKey, sharedKey);
  } catch (err) {
    debug('Failed to decrypt permission key: ' + fileKey);
    return;
  }

  return {
    type: 'permission',
    key: cryptoUtils.toHumanReadableString(fileKey),
    sharedKey: sharedKey,
    from: from,
    to: to,
    tx: tx
  }
}

/**
 * Attempt to deduce the permission key and ECDH shared key
 *   from the parties involved in the bitcoin transaction
 * @param  {Transaction} tx
 * @param  {TransactionData} txData
 * @return {Object}   permission file "key" and ECDH "sharedKey" to decrypt it
 */
TxParser.prototype.deduceECDHKeys = function(tx, txData) {
  if (!(this.wallet && txData)) return;

  var wallet = this.wallet;
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
      var addr = common.getAddressFromInput(input, this.networkName);
      myPrivKey = wallet.getPrivateKeyForAddress(addr);
      return myPrivKey;
    }, this);

    toMe.some(function(out) {
      var addr = common.getAddressFromOutput(out, this.networkName);
      if (addr && !wallet.isChangeAddress(addr)) {
        theirPubKey = wallet.getPublicKeyForAddress(addr);
        return true;
      }
    }, this);
  } else {
    myAddress = common.getAddressFromOutput(toMe[0], this.networkName);
    myPrivKey = wallet.getPrivateKeyForAddress(myAddress);
    theirPubKey = bitcoin.ECPubKey.fromBuffer(tx.ins[0].script.chunks[1]);
  }

  return myPrivKey && theirPubKey && {
    priv: myPrivKey,
    pub: theirPubKey
  }
}

/**
 *  @return {Array} outputs in tx that the underlying wallet can spend
 */
TxParser.prototype.getSentToMe = function(tx) {
  if (!this.wallet) return [];

  return tx.outs.filter(function(out) {
    var address = common.getAddressFromOutput(out, this.networkName);
    return this.wallet.getPrivateKeyForAddress(address) && out;
  }, this);
}

/**
 *  @return {Array} inputs in tx that are signed by the underlying wallet
 */
TxParser.prototype.getSentFromMe = function(tx) {
  if (!this.wallet) return [];

  return tx.ins.filter(function(input) {
    var address = common.getAddressFromInput(input, this.networkName);
    return this.wallet.getPrivateKeyForAddress(address) && input;
  }, this);
}

module.exports = TxParser;
