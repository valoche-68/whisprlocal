const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../../src/local/initialize.js"), "utf8");

for (const imported of [false, true]) {
  test(`startup disables unsupported screen capture ${imported ? "after migration" : "in an existing profile"} while preserving the text assistant`, () => {
    const values = new Map(
      Object.entries(
        imported
          ? {}
          : {
              whisprlocalProfileImported: "true",
              voiceAgentScreenContext: "true",
              useDictationAgentVisionModel: "true",
              useDictationAgent: "true",
              dictationAgentMode: "self-hosted",
            }
      )
    );
    const storage = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, String(value)),
    };
    vm.runInNewContext(source, {
      localStorage: storage,
      window: {
        electronAPI: {
          readMigrationPreferences: () => ({
            voiceAgentScreenContext: "true",
            useDictationAgentVisionModel: "true",
            useDictationAgent: "true",
            dictationAgentMode: "self-hosted",
          }),
        },
      },
    });
    assert.equal(storage.getItem("voiceAgentScreenContext"), "false");
    assert.equal(storage.getItem("useDictationAgentVisionModel"), "false");
    assert.equal(storage.getItem("useDictationAgent"), "true");
    assert.equal(storage.getItem("dictationAgentMode"), "self-hosted");
  });
}

test("only explicitly self-hosted legacy Custom speech servers migrate to endpoint settings", () => {
  const values = new Map(Object.entries({
    transcriptionMode: "self-hosted",
    cloudTranscriptionProvider: "custom",
    cloudTranscriptionBaseUrl: "http://speech.local:8200/v1",
    cloudTranscriptionModel: "whisper",
    meetingTranscriptionMode: "self-hosted",
    meetingUseLocalWhisper: "false",
    uploadTranscriptionMode: "self-hosted",
    uploadCloudTranscriptionProvider: "custom",
    uploadCloudTranscriptionBaseUrl: "https://api.openwhispr.com./v1",
    uploadCloudTranscriptionModel: "remote-model",
  }));
  const context = {
    URL,
    localStorage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, String(value)),
    },
    window: {},
  };
  vm.runInNewContext(source, { ...context });
  assert.equal(values.get("remoteTranscriptionUrl"), "http://speech.local:8200/v1");
  assert.equal(values.get("remoteTranscriptionModel"), "whisper");
  assert.equal(values.get("meetingTranscriptionMode"), "local");
  assert.equal(values.get("meetingUseLocalWhisper"), "true");
  assert.equal(values.has("uploadRemoteTranscriptionUrl"), false);
  assert.equal(values.has("uploadRemoteTranscriptionModel"), false);

  values.set("uploadCloudTranscriptionBaseUrl", "https://upload.example.org/v1");
  values.set("uploadTranscriptionMode", "local");
  vm.runInNewContext(source, { ...context });
  assert.equal(values.has("uploadRemoteTranscriptionUrl"), false);

  values.set("uploadTranscriptionMode", "self-hosted");
  values.set("remoteTranscriptionUrl", "https://chosen.example.org/v1");
  vm.runInNewContext(source, { ...context });
  assert.equal(values.get("uploadRemoteTranscriptionUrl"), "https://upload.example.org/v1");
  assert.equal(values.get("uploadRemoteTranscriptionModel"), "remote-model");
  assert.equal(values.get("remoteTranscriptionUrl"), "https://chosen.example.org/v1");
});
