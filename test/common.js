var Joe = require('../')
var helpers = require('tradle-test-helpers')
var FakeKeeper = helpers.FakeKeeper
var fakeWallet = helpers.fakeWallet

module.exports = {
  nulls: function (size) {
    var arr = []
    while (size--) {
      arr.push(null)
    }

    return arr
  },
  mkJoe: function (privateWif, balance) {
    return new Joe({
      wallet: fakeWallet(privateWif, balance || 500000),
      keeper: FakeKeeper.empty(),
      prefix: 'test',
      networkName: 'testnet',
      minConf: 0
    })
  }
}
