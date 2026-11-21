const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const dbus = require("@homebridge/dbus-native");

const debugLogger = require("../../src/helpers/debugLogger.js");
const KDEShortcutManager = require("../../src/helpers/kdeShortcut.js");

test("KDE removes the retired Agent shortcut with its exact persisted action ID", async () => {
  const actionIds = [];
  const manager = new KDEShortcutManager();
  manager.kglobalaccel = {
    unRegister(actionId, callback) {
      actionIds.push(actionId);
      callback(null);
    },
  };

  await manager.removeRetiredAgentKeybinding();

  assert.deepEqual(actionIds, [["openwhispr", "agent", "OpenWhispr", "OpenWhispr agent"]]);
});

test("a KDE retired-shortcut cleanup error is logged and absorbed", async (t) => {
  const messages = [];
  const originalLog = debugLogger.log;
  debugLogger.log = (...args) => messages.push(args.map(String).join(" "));
  t.after(() => {
    debugLogger.log = originalLog;
  });

  const manager = new KDEShortcutManager();
  manager.kglobalaccel = {
    unRegister(_actionId, callback) {
      callback(new Error("cleanup unavailable"));
    },
  };

  await assert.doesNotReject(manager.removeRetiredAgentKeybinding());
  assert.ok(messages.some((message) => message.includes("cleanup unavailable")));
});

test("KDE startup keeps the native shortcut service when it responds", async (t) => {
  const connection = new EventEmitter();
  const service = {};
  connection.end = () => {};
  t.mock.method(dbus, "sessionBus", () => ({
    connection,
    getService(name) {
      assert.equal(name, "org.kde.kglobalaccel");
      return {
        getInterface(path, interfaceName, callback) {
          assert.equal(path, "/kglobalaccel");
          assert.equal(interfaceName, "org.kde.KGlobalAccel");
          callback(null, service);
        },
      };
    },
  }));
  const manager = new KDEShortcutManager();
  assert.equal(await manager.init(), true);
  assert.equal(manager.kglobalaccel, service);
  manager.close();
});

test("KDE startup falls back when an unavailable session bus does not reply", async (t) => {
  const connection = new EventEmitter();
  let ended = false;
  connection.end = () => {
    ended = true;
  };
  t.mock.method(dbus, "sessionBus", () => ({
    connection,
    getService: () => ({ getInterface() {} }),
  }));
  const manager = new KDEShortcutManager({ callTimeoutMs: 10 });
  assert.equal(await manager.init(), false);
  assert.equal(manager.bus, null);
  assert.equal(manager.kglobalaccel, null);
  assert.equal(ended, true);
});

test("KDE startup falls back promptly on a session connection error", async (t) => {
  const connection = new EventEmitter();
  connection.end = () => {};
  t.mock.method(dbus, "sessionBus", () => ({
    connection,
    getService: () => ({
      getInterface() {
        queueMicrotask(() => connection.emit("error", new Error("Session unavailable")));
      },
    }),
  }));
  const manager = new KDEShortcutManager();
  assert.equal(await manager.init(), false);
  assert.equal(manager.bus, null);
});

test("KDE retired shortcut cleanup settles if the service stops replying", async () => {
  const manager = new KDEShortcutManager({ callTimeoutMs: 10 });
  manager.kglobalaccel = { unRegister() {} };
  await manager.removeRetiredAgentKeybinding();
});
