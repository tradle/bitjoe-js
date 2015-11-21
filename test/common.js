var Q = require('q')
var Joe = require('../')
var bitcoin = require('@tradle/bitcoinjs-lib')
var helpers = require('@tradle/test-helpers')
var fakeKeeper = helpers.fakeKeeper
var fakeWallet = helpers.fakeWallet
var ChainLoader = require('@tradle/chainloader')
// var mi = require('midentity')
// var Identity = mi.Identity
// var AddressBook = mi.AddressBook
// var kiki = require('kiki')
// var Keys = kiki.Keys

var common = module.exports = {
  nulls: function (size) {
    var arr = []
    while (size--) {
      arr.push(null)
    }

    return arr
  },
  mkJoe: function (privateWif, sendFn) {
    var wallet = fakeWallet({
      priv: privateWif,
      unspents: [500000]
    })

    if (sendFn) {
      var send = wallet.send
      wallet.send = function () {
        var spender = send.apply(wallet, arguments)
        // var execute = spender.execute
        spender._spend = function (cb) {
          sendFn(this.tx)
          cb(null, this.tx)
        }

        return spender
      }

      wallet.sendTx = function (tx, cb) {
        sendFn(tx)
        cb(null, tx)
      }
    }

    return new Joe({
      wallet: wallet,
      keeper: fakeKeeper.empty(),
      prefix: 'test',
      networkName: 'testnet',
      minConf: 0
    })
  },
  // identityFor: function (key, networkName) {
  //   var priv, pub
  //   if (key.pub) {
  //     priv = key
  //     pub = key.pub
  //   } else {
  //     pub = key
  //   }

  //   networkName = networkName || 'testnet'
  //   var i = new Identity()
  //     .addKey(new Keys.Bitcoin({
  //       priv: priv,
  //       pub: pub,
  //       networkName: networkName,
  //       purpose: 'file-sharing'
  //     }))

  //   mi.defaultKeySet({
  //     networkName: networkName
  //   }).forEach(i.addKey, i)

  //   return i
  // },
  chainloaderFor: function (joe, friends) {
    var networkName = joe.config('networkName')
    var network = bitcoin.networks[networkName]
    var addressBook = {}
    var priv = joe.wallet().priv
    var joePriv = {
      type: 'bitcoin',
      network: networkName,
      priv: priv.toWIF(network),
      value: priv.pub.toHex(),
      fingerprint: priv.pub.getAddress(network).toString(),
      purpose: 'messaging'
    }

    if (friends) {
      friends.forEach(function (f) {
        var key = bitcoin.ECKey.fromWIF(f)
        var pub = {
          type: 'bitcoin',
          network: networkName,
          value: key.pub.toHex(),
          fingerprint: key.pub.getAddress(network).toString(),
          purpose: 'messaging'
        }

        addressBook[pub.fingerprint] = pub
      })
    }

    // var joeIdent = common.identityFor(joe.wallet().priv, net)
    // var pubs = joeIdent.exportKeys()
    // var privs = joeIdent.exportKeys(true)

    return new ChainLoader({
      wallet: joe.wallet(),
      keeper: joe.keeper(),
      networkName: networkName,
      prefix: joe.config('prefix'),
      lookup: function (addr, returnPrivate) {
        if (addr === joe.wallet().addressString) {
          return Q.resolve({
            key: joePriv
          })
        }

        if (addressBook[addr]) {
          return Q.resolve({
            key: addressBook[addr]
          })
        } else {
          return Q.reject(new Error('not found'))
        }
      }
    })
  }
}
