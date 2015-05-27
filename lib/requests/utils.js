var debug = require('debug')('reqUtils')
var utils = require('tradle-utils')
var bitcoin = require('bitcoinjs-lib')

module.exports = {
  store: function (keeper, key, value) {
    key = key.toString('hex')

    return keeper.put(key, value)
      .catch(function (err) {
        debug('Failed to get data from keeper: ' + err)
        throw utils.httpError(err.code || 400, err.message || 'Failed to store data on keeper')
      })
  },
  toDataTx: function (wallet, tx, txData) {
    // createTx is not idempotent - it adds a new change address
    // var dataTx = wallet.createTx(toAddress.toString(), self._permissionCost, null, minConf, txData.serialize())

    var dataTxb = new bitcoin.TransactionBuilder()
    var addresses = []
    tx.ins.forEach(function (txIn) {
      dataTxb.addInput(txIn.hash, txIn.index, txIn.sequence)
      addresses.push(wallet.getAddressFromInput(txIn))
    })

    // Extract/add outputs
    tx.outs.forEach(function (txOut) {
      dataTxb.addOutput(txOut.script, txOut.value)
    })

    dataTxb.addOutput(bitcoin.scripts.nullDataOutput(txData.serialize()), 0)
    addresses.forEach(function (address, i) {
      dataTxb.sign(i, wallet.getPrivateKeyForAddress(address))
    })

    return dataTxb.build()
  }
}
