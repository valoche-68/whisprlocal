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
