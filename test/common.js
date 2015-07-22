var Q = require('q')
var Joe = require('../')
var bitcoin = require('bitcoinjs-lib')
var helpers = require('tradle-test-helpers')
var fakeKeeper = helpers.fakeKeeper
var fakeWallet = helpers.fakeWallet
var ChainLoader = require('chainloader')
var mi = require('midentity')
var Identity = mi.Identity
var AddressBook = mi.AddressBook
var Keys = mi.Keys

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
  identityFor: function (key, networkName) {
    var priv, pub
    if (key.pub) {
      priv = key
      pub = key.pub
    } else {
      pub = key
    }

    return new Identity()
      .addKey(new Keys.Bitcoin({
        priv: priv,
        pub: pub,
        networkName: networkName || 'testnet',
        purpose: 'file-sharing'
      }))
  },
  chainloaderFor: function (joe, friends) {
    var net = joe.config('networkName')
    var addressBook
    if (friends) {
      addressBook = new AddressBook()
      friends.forEach(function (pk) {
        addressBook.add(common.identityFor(bitcoin.ECKey.fromWIF(pk)))
      })
    }

    var joeIdent = common.identityFor(joe.wallet().priv, net)
    var pubs = joeIdent.exportKeys()
    var privs = joeIdent.exportKeys(true)

    return new ChainLoader({
      wallet: joe.wallet(),
      keeper: joe.keeper(),
      networkName: net,
      prefix: joe.config('prefix'),
      lookup: function (addr, returnPrivate) {
        if (addr === joe.wallet().addressString) {
          var keys = returnPrivate ? privs : pubs
          return Q.resolve({
            key: keys.filter(function (k) {return k.fingerprint === addr})[0],
            identity: joeIdent
          })
        }

        return Q.resolve(addressBook.byFingerprint(addr))
          .then(function (result) {
            result.identity = result.identity.toJSON()
            result.key = result.key.toJSON()
            return result
          })
      }
    })
  }
}
