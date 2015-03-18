
function FakePlugin() {}

FakePlugin.prototype.process = function(obj) {
  obj._processed = true;
}
