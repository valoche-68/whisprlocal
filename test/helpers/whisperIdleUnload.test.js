const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const { EventEmitter } = require("node:events");
const { pcm16Mono16kWav } = require("./harness/wavFixtures");

// No Electron runtime or GPU downloads are needed for these lifecycle tests.
const modulePath = require.resolve("../../src/helpers/whisperServer");
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "electron") return { app: { isReady: () => false } };
  if (parent?.filename === modulePath) {
    if (request === "./whisperCudaManager" || request === "./whisperVulkanManager") {
      return { BIN_SUBDIR: "unused" };
    }
    if (request === "./debugLogger") {
      return { debug() {}, info() {}, warn() {}, error() {} };
    }
  }
  return originalLoad.call(this, request, parent, isMain);
};
let WhisperServerManager;
try {
  WhisperServerManager = require(modulePath);
} finally {
  Module._load = originalLoad;
}

function runningManager(t) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const manager = new WhisperServerManager();
  manager._doStart = async (modelPath, options) => {
    manager.modelPath = modelPath;
    manager.ready = true;
    manager._stopRequested = false;
    manager.useCuda = options.useCuda === true;
    manager.useVulkan = !manager.useCuda && options.useVulkan === true;
    manager.gpuSignature = WhisperServerManager.getGpuSignature(options);
    const child = new EventEmitter();
    child.exitCode = null;
    child.kill = () => queueMicrotask(() => child.emit("close"));
    manager.process = child;
  };
  t.after(() => manager.clearIdleTimer());
  return manager;
}

async function finishIdleStop(manager) {
  await manager.idleStopPromise;
}

test("unloads after five seconds and a fresh start restores the selected GPU and VAD", async (t) => {
  const manager = runningManager(t);
  const options = { useCuda: true, vadEnabled: true, vadModelPath: "/vad.bin", threads: 4 };
  await manager.start("/model.bin", options);
  t.mock.timers.tick(4999);
  assert.ok(manager.process);
  t.mock.timers.tick(1);
  await finishIdleStop(manager);
  assert.equal(manager.process, null);
  assert.equal(manager.ready, false);
  await manager.start("/model.bin", options);
  assert.equal(manager.ready, true);
  assert.equal(manager.useCuda, true);
  assert.deepEqual(manager.lastStartOptions, options);
  assert.equal(manager.vadSignature, WhisperServerManager.getVadSignature(options));
  assert.equal(manager.gpuSignature, "gpu:cuda");
});

test("a dictation arriving during idle shutdown waits before restarting", async (t) => {
  const manager = runningManager(t);
  await manager.start("/model.bin");
  t.mock.timers.tick(5000);
  assert.ok(manager.idleStopPromise);
  await manager.start("/model.bin", { useVulkan: true });
  assert.equal(manager.ready, true);
  assert.equal(manager.modelPath, "/model.bin");
  assert.equal(manager.gpuSignature, "gpu:vulkan:default");
});

test("overlapping transcriptions hold memory until the last request ends", async (t) => {
  const manager = runningManager(t);
  await manager.start("/model.bin");
  const complete = [];
  manager._postInference = () => new Promise((resolve) => complete.push(resolve));
  const first = manager.transcribe(pcm16Mono16kWav());
  const second = manager.transcribe(pcm16Mono16kWav());
  t.mock.timers.tick(900000);
  assert.ok(manager.process);
  complete[0]({ text: "first" });
  await first;
  t.mock.timers.tick(900000);
  assert.ok(manager.process);
  assert.equal(manager.idleTimer, null);
  complete[1]({ text: "second" });
  await second;
  t.mock.timers.tick(4999);
  assert.ok(manager.process);
  t.mock.timers.tick(1);
  await finishIdleStop(manager);
  assert.equal(manager.process, null);
});

test("audio conversion is protected and failures still arm idle cleanup", async (t) => {
  const manager = runningManager(t);
  await manager.start("/model.bin");
  manager.canConvert = true;
  let rejectConversion;
  manager._convertToWav = () =>
    new Promise((_, reject) => {
      rejectConversion = reject;
    });
  const pending = manager.transcribe(Buffer.from("webm"));
  const rejected = assert.rejects(pending, /conversion failed/);
  t.mock.timers.tick(600000);
  assert.ok(manager.process);
  rejectConversion(new Error("conversion failed"));
  await rejected;
  t.mock.timers.tick(5000);
  await finishIdleStop(manager);
  assert.equal(manager.process, null);
});

test("a cancelled request does not disable subsequent idle cleanup", async (t) => {
  const manager = runningManager(t);
  await manager.start("/model.bin");
  await assert.rejects(manager.transcribe(pcm16Mono16kWav(), { signal: AbortSignal.abort() }), {
    name: "AbortError",
  });
  t.mock.timers.tick(5000);
  await finishIdleStop(manager);
  assert.equal(manager.process, null);
});

test("a remote server never receives an idle shutdown", async (t) => {
  const manager = runningManager(t);
  manager.isRemote = true;
  manager.ready = true;
  manager.resetIdleTimer();
  t.mock.timers.tick(600000);
  assert.equal(manager.idleTimer, null);
  assert.equal(manager.ready, true);
});

test("explicit stop cancels the timer", async (t) => {
  const manager = runningManager(t);
  await manager.start("/model.bin");
  await manager.stop();
  assert.equal(manager.idleTimer, null);
  t.mock.timers.tick(600000);
  assert.equal(manager.idleStopPromise, null);
});

test("starting the loaded model resets the inactivity deadline", async (t) => {
  const manager = runningManager(t);
  await manager.start("/model.bin");
  t.mock.timers.tick(4000);
  await manager.start("/model.bin");
  t.mock.timers.tick(4000);
  assert.ok(manager.process);
  t.mock.timers.tick(1000);
  await finishIdleStop(manager);
  assert.equal(manager.process, null);
});

test("timeout override supports disabling cleanup and rejects invalid values", () => {
  const saved = process.env.WHISPER_IDLE_TIMEOUT_MS;
  try {
    for (const [value, expected] of [
      ["0", 0],
      ["1000", 1000],
      ["", 5000],
      ["-1", 5000],
      ["oops", 5000],
      ["2147483648", 5000],
    ]) {
      process.env.WHISPER_IDLE_TIMEOUT_MS = value;
      assert.equal(new WhisperServerManager().idleTimeoutMs, expected);
    }
  } finally {
    if (saved === undefined) delete process.env.WHISPER_IDLE_TIMEOUT_MS;
    else process.env.WHISPER_IDLE_TIMEOUT_MS = saved;
  }
});

test("idle timer does not keep the application alive", async (t) => {
  const manager = new WhisperServerManager();
  manager.process = {};
  manager.ready = true;
  t.after(() => manager.clearIdleTimer());
  manager.resetIdleTimer();
  assert.equal(manager.idleTimer.hasRef(), false);
});

test("changing the timeout applies immediately and never can be reversed", async (t) => {
  const manager = runningManager(t);
  await manager.start("/model.bin");
  manager.setIdleTimeoutSeconds(0);
  t.mock.timers.tick(600000);
  assert.ok(manager.process);
  manager.setIdleTimeoutSeconds(10);
  t.mock.timers.tick(9999);
  assert.ok(manager.process);
  t.mock.timers.tick(1);
  await finishIdleStop(manager);
  assert.equal(manager.process, null);
});

test("preference updates do not reset an unchanged deadline or accept invalid values", async (t) => {
  const manager = runningManager(t);
  await manager.start("/model.bin");
  t.mock.timers.tick(4000);
  for (const value of [5, undefined, -1, 1.5, NaN, Infinity, 86401]) {
    manager.setIdleTimeoutSeconds(value);
  }
  t.mock.timers.tick(1000);
  await finishIdleStop(manager);
  assert.equal(manager.process, null);
});

test("changing the timeout during transcription waits for its completion", async (t) => {
  const manager = runningManager(t);
  await manager.start("/model.bin");
  let complete;
  manager._postInference = () =>
    new Promise((resolve) => {
      complete = resolve;
    });
  const pending = manager.transcribe(pcm16Mono16kWav());
  manager.setIdleTimeoutSeconds(10);
  t.mock.timers.tick(600000);
  assert.ok(manager.process);
  complete({ text: "done" });
  await pending;
  t.mock.timers.tick(9999);
  assert.ok(manager.process);
  t.mock.timers.tick(1);
  await finishIdleStop(manager);
  assert.equal(manager.process, null);
});
