var test = require('tape')
var midentity = require('midentity')
var Identity = midentity.Identity
var AddressBook = midentity.AddressBook
var Keys = midentity.Keys
var common = require('./common')
var DATA = new Buffer('blah')
var rimraf = require('rimraf')
var leveldown = require('leveldown')
var FakeKeeper = require('tradle-test-helpers').FakeKeeper
var Joe = require('../')
var sharedKeeper = FakeKeeper.forMap({})
var config = {
  wallet: {
    path: './test/joe.wallet',
    autosave: true
  },
  leveldown: leveldown,
  keeper: sharedKeeper,
  prefix: 'test',
  networkName: 'testnet',
  syncInterval: 10000,
  minConf: 0
}

var joe = new Joe(config)
var people = [
  {
    name: {
      firstName: 'Bill',
      middleName: 'S',
      lastName: 'Preston',
      formatted: 'Bill S. Preston'
    }
  },
  {
    name: {
      firstName: 'Ted',
      middleName: 'Theodore',
      lastName: 'Logan',
      formatted: 'Ted Theodore Logan'
    }
  },
  {
    name: {
      firstName: 'Rufus',
      formatted: 'Rufus'
    }
  }
]

test('recognize txs from contacts in addressbook', function (t) {
  t.plan(2)

  var addressBook = new AddressBook()
  var identities = makeIdentities()
  identities.forEach(function (id) {
    addressBook.add(id)
  })

  var me
  var to = identities[0]
  joe.addressBook(addressBook)
  joe.on('walletready', function () {
    me = new Identity({
      firstName: 'Me',
      middleName: 'Baby',
      lastName: 'Me'
    })

    for (var i = 0; i < 3; i++) {
      var addr = joe.wallet().getNextAddress(i)
      var priv = joe.wallet().getPrivateKeyForAddress(addr)
      me.addKey(new Keys.Bitcoin({
        networkName: joe.config('networkName'),
        priv: priv
      }))
    }

    joe.identity(me)
    common.promiseFund(joe)
      .then(function () {
        return joe.create()
          .data(DATA)
          .shareWith(firstKey(to).pub())
          .execute()
      })
      .done()
  })

  joe.once('file', function (info) {
    t.equal(info.from.identity, me)
    t.equal(info.to.identity, to)
  })
})

test('cleanup', function (t) {
  // common.cleanup(t.end)
  joe.destroy()
    .done(function () {
      rimraf(config.wallet.path, t.end)
    })
})

function makeIdentities () {
  return people.map(function (p) {
    return Identity.fromJSON(p)
      .addKey(new Keys.Bitcoin({
        networkName: 'testnet',
        pub: Keys.Bitcoin.gen('testnet').pub()
      }))
  })
}

function firstKey (identity, category) {
  return identity.keys(category || 'bitcoin')[0]
}
