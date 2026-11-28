const { withDevicePolicy } = require("./harness/devicePolicy");
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");
const { setConfigured } = require("../../src/local/networkPolicy.cjs");
const { createUploadCancelRegistry } = require("../../src/helpers/uploadCancelRegistry");

const handlersModulePath = require.resolve("../../src/helpers/ipcHandlers");
const originalLoad = Module._load;
const handlers = new Map();
const userDataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "local-server-sync-ipc-"));

const MODEL = "qwen3.5-4b-q4_k_m";
const modelManager = {
  currentServerModelId: null,
  stops: 0,
  getServerStatus: () => ({ running: true }),
  stopServerWhenIdle: async () => {
    modelManager.stops += 1;
  },
  serverManager: {
    cancelledStops: 0,
    cancelDeferredStop: () => {
      modelManager.serverManager.cancelledStops += 1;
    },
    keepResident: null,
    setKeepResident: (keepResident) => {
      modelManager.serverManager.keepResident = keepResident;
    },
  },
};

const electronStub = {
  app: {
    getPath: () => userDataDirectory,
    getName: () => "test",
    getVersion: () => "0.0.0",
    isPackaged: false,
    on: () => {},
    requestSingleInstanceLock: () => true,
  },
  ipcMain: {
    handle(channel, handler) {
      assert.equal(handlers.has(channel), false, `Duplicate IPC handler: ${channel}`);
      handlers.set(channel, handler);
    },
    on: () => {},
    removeHandler: () => {},
  },
  net: { fetch: async () => ({ ok: true, status: 200, json: async () => ({}) }) },
  BrowserWindow: class BrowserWindow {
    static getAllWindows() {
      return [];
    }

    static fromWebContents() {
      return null;
    }
  },
  shell: {},
  dialog: {},
  screen: { getPrimaryDisplay: () => ({ workAreaSize: { width: 0, height: 0 } }) },
  systemPreferences: { getMediaAccessStatus: () => "granted" },
  session: { fromPartition: () => ({}) },
  clipboard: {},
  nativeImage: {},
  globalShortcut: {},
  utilityProcess: {},
  MessageChannelMain: class {},
};

Module._load = function loadWithStubs(request, parent, isMain) {
  if (request === "electron") return electronStub;
  if (parent?.filename === handlersModulePath && request === "./debugLogger") {
    return new Proxy({}, { get: () => () => {} });
  }
  if (parent?.filename === handlersModulePath && request === "./modelManagerBridge") {
    return { default: modelManager };
  }
  return originalLoad.call(this, request, parent, isMain);
};

function anything() {
  return new Proxy(function () {}, {
    get: (_target, property) => {
      if (property === Symbol.toPrimitive || property === "toString") return () => "";
      if (property === "then") return undefined;
      return anything();
    },
    apply: () => anything(),
  });
}

let target;
test.before(() => {
  delete require.cache[handlersModulePath];
  const IPCHandlers = require(handlersModulePath);
  const Ctor = IPCHandlers.default || IPCHandlers;
  target = {
    signedIn: false,
    envKeys: [],
    whisperManager: {
      stopServer: async () => {},
      serverManager: {
        idleTimeoutSeconds: null,
        setIdleTimeoutSeconds(seconds) {
          this.idleTimeoutSeconds = seconds;
        },
      },
    },
  };
  target._syncStartupEnv = (setVars, clearVars) => {
    target.envKeys = [...Object.keys(setVars), ...clearVars];
  };
  target._hasActiveAccountScope = () => target.signedIn;
  Ctor.prototype.setupHandlers.call(
    withDevicePolicy(
      new Proxy(target, {
        get: (value, property) => (property in value ? value[property] : anything()),
      })
    )
  );
  assert.ok(handlers.get("sync-startup-preferences"), "sync handler must be registered");
});

test.after(() => {
  target.metaActivation?.dispose();
  Module._load = originalLoad;
  fs.rmSync(userDataDirectory, { recursive: true, force: true });
});

function sync({ loaded, signedIn = false, policySettled = true, ...scopes }) {
  modelManager.currentServerModelId = loaded;
  modelManager.stops = 0;
  target.signedIn = signedIn;
  return handlers.get("sync-startup-preferences")(
    {},
    {
      useLocalWhisper: false,
      useCleanupModel: true,
      cleanupMode: "openwhispr",
      useDictationAgent: true,
      dictationAgentMode: "openwhispr",
      noteFormattingMode: "openwhispr",
      chatAgentMode: "openwhispr",
      useDictationTranslation: false,
      translationMode: "openwhispr",
      policySettled,
      ...scopes,
    }
  );
}

test("only a dictation speech engine change stops servers shared with local meetings", async (t) => {
  const stopped = [];
  const previousWhisperManager = target.whisperManager;
  const previousParakeetManager = target.parakeetManager;
  target.whisperManager = {
    ...previousWhisperManager,
    stopServer: async () => stopped.push("whisper"),
  };
  target.parakeetManager = { stopServer: async () => stopped.push("parakeet") };
  t.after(() => {
    target.whisperManager = previousWhisperManager;
    if (previousParakeetManager === undefined) delete target.parakeetManager;
    else target.parakeetManager = previousParakeetManager;
  });

  await sync({ cleanupMode: "local", cleanupModel: MODEL });
  assert.deepEqual(stopped.splice(0), ["whisper", "parakeet"], "apply the initial cloud route");
  await sync({ cleanupMode: "enterprise", cleanupModel: "managed-model" });
  assert.deepEqual(stopped, [], "a managed cleanup update must leave the meeting decode alone");

  const local = { useLocalWhisper: true, localTranscriptionProvider: "nvidia", model: "parakeet" };
  await sync(local);
  assert.deepEqual(stopped.splice(0), ["whisper"]);
  await sync({ ...local, language: "de" });
  assert.deepEqual(stopped, [], "the same engine can be reported by another window");
  await sync({ ...local, localTranscriptionProvider: "whisper", model: "tiny" });
  assert.deepEqual(stopped.splice(0), ["parakeet"]);
  await sync({});
  assert.deepEqual(stopped, ["whisper", "parakeet"], "an actual cloud switch still retires both");
});

test("a window sync keeps the server while another scope still needs its model", async () => {
  const cancelled = modelManager.serverManager.cancelledStops;
  await sync({ loaded: MODEL, chatAgentMode: "local", chatAgentModel: MODEL });
  assert.equal(modelManager.stops, 0);
  assert.equal(
    modelManager.serverManager.cancelledStops,
    cancelled + 1,
    "a stop deferred by an earlier sync no longer applies"
  );
});

test("a window sync stops the server once no scope needs its model", async () => {
  await sync({ loaded: MODEL, chatAgentMode: "local", chatAgentModel: "gemma-4-e2b" });
  assert.equal(modelManager.stops, 1);
});

test("a signed-in window waits for its workspace policy before touching the server", async () => {
  await sync({ loaded: MODEL, signedIn: true, policySettled: false });
  assert.equal(modelManager.stops, 0);
  assert.equal(target.envKeys.includes("CLEANUP_PROVIDER"), false, "no pre-warm change either");

  await sync({ loaded: MODEL, signedIn: true, policySettled: true });
  assert.equal(modelManager.stops, 1);
});

test("signed out, the policy never loads, so an unresolved policy does not block the stop", async () => {
  await sync({ loaded: MODEL, signedIn: false, policySettled: false });
  assert.equal(modelManager.stops, 1);
});

test("Keep model loaded applies before the workspace policy settles", async () => {
  await sync({ loaded: MODEL, signedIn: true, policySettled: false, keepLocalModelLoaded: true });
  assert.equal(modelManager.serverManager.keepResident, true);

  await sync({ loaded: MODEL, signedIn: true, policySettled: false });
  assert.equal(modelManager.serverManager.keepResident, false, "missing means off");
});

test("Whisper idle sync applies delay changes and disabling without restarting the app", async () => {
  await sync({ whisperIdleUnloadEnabled: true, whisperIdleTimeoutSeconds: 30 });
  assert.equal(target.whisperManager.serverManager.idleTimeoutSeconds, 30);
  await sync({ whisperIdleUnloadEnabled: false, whisperIdleTimeoutSeconds: 30 });
  assert.equal(target.whisperManager.serverManager.idleTimeoutSeconds, 0);
  await sync({ whisperIdleUnloadEnabled: true, whisperIdleTimeoutSeconds: 30 });
  assert.equal(target.whisperManager.serverManager.idleTimeoutSeconds, 30);
});

test("a downloaded GPU binary requests an idle stop that preferences cannot cancel", async (t) => {
  const previousEnabled = process.env.LLAMA_VULKAN_ENABLED;
  const previousBackend = process.env.LLAMA_GPU_BACKEND;
  t.after(() => {
    if (previousEnabled === undefined) delete process.env.LLAMA_VULKAN_ENABLED;
    else process.env.LLAMA_VULKAN_ENABLED = previousEnabled;
    if (previousBackend === undefined) delete process.env.LLAMA_GPU_BACKEND;
    else process.env.LLAMA_GPU_BACKEND = previousBackend;
    delete target._llamaVulkanManager;
    delete target.environmentManager;
  });
  target._llamaVulkanManager = { download: async () => ({ success: true }) };
  target.environmentManager = { saveAllKeysToEnvFile: async () => {} };
  const stop = t.mock.method(modelManager, "stopServerWhenIdle", async () => {});

  const result = await handlers.get("download-llama-vulkan-binary")({
    sender: { isDestroyed: () => true },
  });

  assert.equal(result.success, true);
  assert.equal(stop.mock.callCount(), 1);
  assert.deepEqual(stop.mock.calls[0].arguments, [{ cancelOnReuse: false }]);
});


test("meeting IPC refuses remote providers before starting a stream", async () => {
  for (const action of ["prepare", "start"]) {
    const result = await handlers.get(`meeting-transcription-${action}`)(
      {},
      { provider: "openai-realtime", mode: "byok" }
    );
    assert.equal(result.success, false);
    assert.equal(result.code, "LOCAL_ONLY");
  }
  const result = await handlers.get("meeting-transcription-prepare")({}, { provider: "local" });
  assert.equal(result.success, true);
});

test("retry sends audio only to a configured self-hosted server with the stored token", async (t) => {
  const endpoint = "https://speech.example.test/v1";
  const row = { id: 1, audio_duration_ms: 100, text: "" };
  target.databaseManager = {
    activeAccountId: null,
    getTranscriptionById: () => row,
    updateTranscriptionText: (id, text) => { row.text = text; },
    updateTranscriptionStatus() {},
    updateTranscriptionAudio() {},
  };
  target.environmentManager = {
    getCustomTranscriptionKey: () => "saved-token",
    getSelfHostedSttHeaders: () => JSON.stringify({
      dictation: [{ name: "X-Dictation-Key", value: "dictation-secret" }],
      upload: [{ name: "X-Upload-Key", value: "upload-secret" }],
    }),
  };
  target.audioStorageManager = { getAudioBuffer: () => Buffer.from("test audio") };
  t.after(() => {
    setConfigured([]);
    delete target.databaseManager;
    delete target.environmentManager;
    delete target.audioStorageManager;
  });
  const fetch = t.mock.method(electronStub.net, "fetch", async () => ({
    ok: true,
    json: async () => ({ text: "bonjour" }),
  }));
  const retry = handlers.get("retry-transcription");
  const settings = {
    transcriptionMode: "self-hosted",
    remoteTranscriptionUrl: endpoint,
    remoteTranscriptionModel: "whisper",
    customTranscriptionApiKey: "stale-renderer-key",
    cloudTranscriptionMode: "openwhispr",
    managed: { kind: "error", message: "obsolete provider" },
  };
  const blocked = await retry({}, 1, settings);
  assert.equal(blocked.success, false);
  assert.equal(fetch.mock.callCount(), 0);
  setConfigured([endpoint]);
  const result = await retry({}, 1, settings);
  assert.equal(result.success, true);
  assert.equal(result.transcription.text, "bonjour");
  assert.equal(fetch.mock.callCount(), 1);
  const [url, options] = fetch.mock.calls[0].arguments;
  assert.equal(url, endpoint + "/audio/transcriptions");
  assert.equal(options.headers.authorization, "Bearer saved-token");
  assert.equal(options.headers["x-dictation-key"], "dictation-secret");
  assert.equal(options.headers["x-upload-key"], undefined);
  assert.equal(options.redirect, "error");
  assert.equal(options.body.get("model"), "whisper");
  assert.equal(await options.body.get("file").text(), "test audio");
});

test("file import ignores stale provider settings and sends audio only to the configured server", async (t) => {
  const endpoint = "https://speech.example.test/v1";
  const audioPath = path.join(userDataDirectory, "audio.wav");
  fs.writeFileSync(audioPath, "test upload");
  target._uploadCancelRegistry = createUploadCancelRegistry();
  target.environmentManager = {
    getCustomTranscriptionKey: () => "saved-token",
    getSelfHostedSttHeaders: () => JSON.stringify({
      dictation: [{ name: "X-Dictation-Key", value: "dictation-secret" }],
      upload: [{ name: "X-Upload-Key", value: "upload-secret" }],
    }),
  };
  t.after(() => {
    setConfigured([]);
    delete target._uploadCancelRegistry;
    delete target.environmentManager;
    fs.rmSync(audioPath, { force: true });
  });
  const fetch = t.mock.method(electronStub.net, "fetch", async () => ({
    ok: true,
    json: async () => ({ text: "bonjour" }),
  }));
  const transcribe = handlers.get("transcribe-audio-file-byok");
  const options = {
    filePath: audioPath,
    requestId: "upload-1",
    transcriptionMode: "self-hosted",
    remoteTranscriptionUrl: endpoint,
    remoteTranscriptionModel: "whisper",
    provider: "openai",
    apiKey: "stale-key",
    managed: { kind: "error", message: "obsolete provider" },
  };
  assert.equal((await transcribe({}, options)).success, false);
  assert.equal(fetch.mock.callCount(), 0);
  setConfigured([endpoint]);
  const result = await transcribe({}, options);
  assert.deepEqual(result, { success: true, text: "bonjour" });
  assert.equal(fetch.mock.callCount(), 1);
  const [url, request] = fetch.mock.calls[0].arguments;
  assert.equal(url, endpoint + "/audio/transcriptions");
  assert.equal(request.headers.authorization, "Bearer saved-token");
  assert.equal(request.headers["x-upload-key"], "upload-secret");
  assert.equal(request.headers["x-dictation-key"], undefined);
  assert.equal(request.body.get("file").type, "audio/wav");
  assert.equal(await request.body.get("file").text(), "test upload");
});

test("a settled cleanup route configures recording prewarm and a managed route clears it", async (t) => {
  const previous = target.dictationCleanupPrewarm;
  const models = [];
  target.dictationCleanupPrewarm = { setModel: (modelId) => models.push(modelId) };
  t.after(() => { target.dictationCleanupPrewarm = previous; });
  await sync({ signedIn: true, policySettled: false, cleanupMode: "local", cleanupModel: MODEL });
  await sync({ signedIn: true, cleanupMode: "local", cleanupModel: MODEL });
  await sync({ signedIn: true, cleanupMode: "enterprise", cleanupModel: "managed-model" });
  assert.deepEqual(models, [MODEL, ""]);
});
