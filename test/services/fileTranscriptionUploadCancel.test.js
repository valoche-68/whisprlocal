const test = require("node:test");
const assert = require("node:assert/strict");
const { createRendererServer, installBrowserGlobals } = require("../lib/rendererTestHarness");

test("a self-hosted file upload hands its cancel id to the main process", async (t) => {
  const { window } = installBrowserGlobals(t);
  const vite = await createRendererServer(t, {
    cachePrefix: "openwhispr-file-upload-cancel-test-",
  });
  const { transcribeFileWithSpeakers } = await vite.ssrLoadModule(
    "/services/fileTranscription.ts"
  );
  let received = null;
  window.electronAPI.transcribeAudioFileByok = async (options) => {
    received = options;
    return { success: true, text: "hello" };
  };

  await transcribeFileWithSpeakers(
    "/tmp/meeting.mp3",
    {
      useLocalWhisper: false,
      localTranscriptionProvider: "whisper",
      whisperModel: "base",
      parakeetModel: "parakeet-tdt-0.6b-v3",
      cohereModel: "",
      isOpenWhisprCloud: false,
      remoteTranscriptionUrl: "http://127.0.0.1:9000/v1",
      remoteTranscriptionModel: "whisper-base",
      language: "",
      transcriptionMode: "self-hosted",
    },
    { enabled: false, localModelsReady: false, numSpeakers: null },
    null,
    { requestId: "upload-7", timestamps: true }
  );

  assert.equal(received.requestId, "upload-7");
  assert.equal(received.transcriptionMode, "self-hosted");
  assert.equal(received.timestamps, true);
});

test("an abandoned local voice take skips the transcription IPC", async (t) => {
  const { window } = installBrowserGlobals(t);
  window.electronAPI.transcribeAudioFile = async () => {
    assert.fail("cancelled voice take must not reach IPC");
  };
  const vite = await createRendererServer(t, {
    cachePrefix: "whisprlocal-file-local-cancel-test-",
  });
  const { transcribeFile } = await vite.ssrLoadModule("/services/fileTranscription.ts");
  await assert.rejects(
    transcribeFile("/tmp/take.webm", {
      useLocalWhisper: true,
      localTranscriptionProvider: "whisper",
      whisperModel: "base",
      transcriptionMode: "local",
    }, false, {
      requestId: "voice-take",
      signal: AbortSignal.abort(),
    }),
    { name: "AbortError" }
  );
});
