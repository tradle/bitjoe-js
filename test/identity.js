
var test = require('tape');
var midentity = require('midentity');
var Identity = midentity.Identity;
var AddressBook = midentity.AddressBook;
var Keys = midentity.Keys;
var common = require('./common');
var DATA = new Buffer('blah');

var people = [
  {
    firstName: 'Bill',
    middleName: 'S',
    lastName: 'Preston'
  }, {
    firstName: 'Ted',
    middleName: 'Theodore',
    lastName: 'Logan'
  }, {
    firstName: 'Rufus'
  }
];

test('recognize txs from contacts in addressbook', function(t) {
  t.plan(2);

  var addressBook = new AddressBook();
  var identities = makeIdentities();
  identities.forEach(function(id) {
    addressBook.add(id);
  });

  var me;
  var to = identities[0];
  var joe = common.mkJoe();
  joe.addressBook(addressBook);
  joe.on('walletready', function() {
    me = new Identity({
      firstName: 'Me',
      middleName: 'Baby',
      lastName: 'Me'
    })

    for (var i = 0; i < 3; i++) {
      var addr = joe.wallet().getNextAddress(i);
      var priv = joe.wallet().getPrivateKeyForAddress(addr);
      me.addKey('bitcoin', new Keys.Bitcoin({
        networkName: joe.config('networkName'),
        priv: priv
      }));
    }

    joe.identity(me);
  });

  common.promiseFund(joe)
    .then(function() {
      return joe.create()
        .data(DATA)
        .shareWith(firstKey(to).pub())
        .execute()
    });

  joe.once('file', function(info) {
    t.equal(info.from.identity, me);
    t.equal(info.to.identity, to);
  });
});

test('cleanup', function(t) {
  common.cleanup(t.end);
})

function makeIdentities() {
  return people.map(function(p) {
    var id = new Identity(p);
    id.addKey('bitcoin', new Keys.Bitcoin({
      networkName: 'testnet',
      pub: Keys.Bitcoin.gen('testnet').pub()
    }));

    return id;
  });
}

function firstKey(identity, category) {
  return identity.keys(category || 'bitcoin')[0];
}
