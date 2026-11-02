const test = require("node:test");
const assert = require("node:assert/strict");
const { createRendererServer, installBrowserGlobals } = require("../lib/rendererTestHarness");

test("deleting a speech model clears every matching scope and preserves other choices", async (t) => {
  installBrowserGlobals(t);
  const vite = await createRendererServer(t, { cachePrefix: "whisprlocal-speech-deletion-" });
  const { useSettingsStore, clearMissingLocalModelSelections } = await vite.ssrLoadModule(
    "/stores/settingsStore.ts"
  );
  useSettingsStore.setState({
    whisperModel: "large",
    meetingWhisperModel: "large",
    uploadWhisperModel: "turbo",
    fallbackWhisperModel: "large",
    parakeetModel: "parakeet",
    meetingParakeetModel: "parakeet",
    uploadParakeetModel: "other",
  });
  clearMissingLocalModelSelections((id) => id !== "large", "whisper");
  let state = useSettingsStore.getState();
  for (const key of ["whisperModel", "meetingWhisperModel", "fallbackWhisperModel"])
    assert.equal(state[key], "", key);
  assert.equal(state.uploadWhisperModel, "turbo");
  assert.equal(state.parakeetModel, "parakeet");
  clearMissingLocalModelSelections((id) => id !== "parakeet", "parakeet");
  state = useSettingsStore.getState();
  assert.equal(state.parakeetModel, "");
  assert.equal(state.meetingParakeetModel, "");
  assert.equal(state.uploadParakeetModel, "other");
});
