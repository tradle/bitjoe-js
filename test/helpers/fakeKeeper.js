
var Q = require('q');
var utils = require('tradle-utils');

function keeperForMap(map) {
  return {
    put: function(key, val) {
      var numPut = 0;
      if (!(key in map)) {
        map[key] = val;
        numPut++;
      }

      return Q.resolve(numPut);
    },
    getOne: function(key) {
      return (key in map) ? Q.resolve(map[key]) : Q.resolve();
    },
    getMany: function(keys) {
      return Q.resolve(keys.map(function(key) {
        return map[key];
      }));
    },
    getAll: function() {
      return Q.resolve(values(map));
    },
    close: function() {
      return Q.resolve();
    },
    isKeeper: function() {
      return true;
    }
  }
}

function keeperForData(data) {
  if (!Array.isArray(data)) data = [data];

  return Q.all(data.map(function(d) {
      if (!Buffer.isBuffer(d)) {
        if (typeof d === 'object') d = new Buffer(JSON.stringify(d));
      }

      return Q.ninvoke(utils, 'getInfoHash', d);
    }))
    .then(function(infoHashes) {
      var map = {};
      for (var i = 0; i < infoHashes.length; i++) {
        map[infoHashes[i]] = data[i];
      }

      return keeperForMap(map)
    });
}

function values(obj) {
  var vals = [];
  for (var p in obj) {
    if (obj.hasOwnProperty(p)) vals.push(obj[p]);
  }

  return vals;
}

module.exports = {
  empty: function() {
    return keeperForMap({});
  },
  forMap: keeperForMap,
  forData: keeperForData
}
