const test = require("node:test"),
  assert = require("node:assert/strict"),
  Module = require("node:module"),
  { EventEmitter } = require("node:events");
const target = require.resolve("../../src/local/linuxUpdateBackend.cjs");
function fixture(t) {
  const original = Module._load,
    app = new EventEmitter(),
    calls = [];
  app.quit = () => {
    calls.push("quit");
    app.emit("before-quit");
  };
  app.getVersion = () => "0.1.0";
  app.getPath = () => "/tmp/profile";
  Module._load = function (name, parent, ...args) {
    if (parent?.filename === target) {
      if (name === "electron") return { app, net: {} };
      if (name === "node:child_process")
        return {
          spawn: (...args) => {
            calls.push(args);
            return { unref() {} };
          },
        };
    }
    return original.call(this, name, parent, ...args);
  };
  delete require.cache[target];
  const Backend = require(target);
  Module._load = original;
  t.after(() => {
    delete require.cache[target];
  });
  const backend = new Backend();
  backend.base = "/tmp/managed";
  backend.staged = "/tmp/managed/versions/0.1.1";
  backend.deb = false;
  return { backend, app, calls };
}
test("an explicitly installed archive launches one detached applier before quitting", (t) => {
  const { backend, calls } = fixture(t);
  backend.autoInstallOnAppQuit = true;
  backend.quitAndInstall();
  assert.equal(calls.filter(Array.isArray).length, 1);
  const invocation = calls.find(Array.isArray);
  assert.equal(invocation[2].env.ELECTRON_RUN_AS_NODE, "1");
  assert.deepEqual(invocation[1].slice(-2), ["/tmp/managed", "/tmp/managed/versions/0.1.1"]);
  assert.equal(calls.at(-1), "quit");
});
test("downloaded managed update applies on quit only while installation on quit is enabled", (t) => {
  const { backend, app, calls } = fixture(t);
  app.emit("before-quit");
  assert.equal(calls.length, 0);
  backend.autoInstallOnAppQuit = true;
  app.emit("before-quit");
  app.emit("before-quit");
  assert.equal(calls.filter(Array.isArray).length, 1);
});
