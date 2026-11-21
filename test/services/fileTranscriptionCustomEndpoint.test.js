const test = require("node:test");
const assert = require("node:assert/strict");
const { createRendererServer, installBrowserGlobals } = require("../lib/rendererTestHarness");

const fixture = {
  useLocalWhisper: false,
  localTranscriptionProvider: "whisper",
  whisperModel: "base",
  parakeetModel: "parakeet-tdt-0.6b-v3",
  isOpenWhisprCloud: false,
  getApiKey: () => {
    throw new Error("Legacy provider keys must not be accessed");
  },
  cloudTranscriptionProvider: "custom",
  cloudTranscriptionBaseUrl: "https://example.test/v1",
  cloudTranscriptionModel: "whisper-1",
  language: "fr",
};

test("file transcription refuses legacy cloud and managed modes before contacting main", async (t) => {
  const { window } = installBrowserGlobals(t);
  const vite = await createRendererServer(t);
  const { transcribeFile } = await vite.ssrLoadModule("/services/fileTranscription.ts");
  const send = t.mock.fn();
  window.electronAPI.transcribeAudioFileByok = send;
  window.electronAPI.transcribeAudioFileCloud = send;
  window.electronAPI.transcribeAudioFile = send;
  for (const transcriptionMode of ["providers", "openwhispr", "enterprise"]) {
    const result = await transcribeFile(
      "/tmp/audio.webm",
      { ...fixture, transcriptionMode, useLocalWhisper: true },
      false
    );
    assert.equal(result.success, false);
    assert.equal(result.code, "LOCAL_ONLY");
  }
  assert.equal(send.mock.callCount(), 0);
});

test("file transcription sends self-hosted options without legacy providers, routes, or keys", async (t) => {
  const { window } = installBrowserGlobals(t);
  const vite = await createRendererServer(t);
  const { transcribeFile } = await vite.ssrLoadModule("/services/fileTranscription.ts");
  const send = t.mock.fn(async () => ({ success: true, text: "Bonjour" }));
  window.electronAPI.transcribeAudioFileByok = send;
  const selfHosted = {
    ...fixture,
    transcriptionMode: "self-hosted",
    remoteTranscriptionUrl: "http://192.168.1.20:9000/v1",
    remoteTranscriptionModel: "whisper-large-v3",
  };

  const incomplete = await transcribeFile(
    "/tmp/audio.webm",
    { ...selfHosted, remoteTranscriptionUrl: "" },
    false
  );
  assert.equal(incomplete.success, false);
  assert.equal(send.mock.callCount(), 0);

  assert.deepEqual(
    await transcribeFile("/tmp/audio.webm", selfHosted, false, { purpose: "upload" }),
    { success: true, text: "Bonjour" }
  );
  assert.equal(send.mock.callCount(), 1);
  const [options] = send.mock.calls[0].arguments;
  assert.equal(options.transcriptionMode, "self-hosted");
  assert.equal(options.remoteTranscriptionUrl, selfHosted.remoteTranscriptionUrl);
  assert.equal(options.remoteTranscriptionModel, selfHosted.remoteTranscriptionModel);
  assert.equal(options.language, "fr");
  assert.equal(options.purpose, "upload");
  for (const key of ["apiKey", "provider", "baseUrl", "model", "managed"]) {
    assert.equal(Object.hasOwn(options, key), false, key);
  }
});
