const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const WhisperManager = require("../../src/helpers/whisper");

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "wl-delete-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const model = path.join(root, "large.bin");
  await fs.writeFile(model, "fixture");
  const manager = Object.create(WhisperManager.prototype);
  manager.getModelPath = () => model;
  manager.serverManager = { modelPath: model, isRemote: false, activeTranscriptions: 0 };
  manager.stopServer = async () => {
    assert.equal(await fs.readFile(model, "utf8"), "fixture", "stop before unlink");
    manager.stopped = true;
  };
  return { manager, model };
}
test("deleting a loaded model closes its engine before unlinking the shared file", async (t) => {
  const { manager, model } = await fixture(t);
  const result = await manager.deleteWhisperModel("large");
  assert.equal(result.success, true);
  assert.equal(manager.stopped, true);
  await assert.rejects(fs.access(model), { code: "ENOENT" });
});
test("busy transcription or download refuses deletion without removing the file", async (t) => {
  const { manager, model } = await fixture(t);
  manager.serverManager.activeTranscriptions = 1;
  assert.equal((await manager.deleteWhisperModel("large")).success, false);
  manager.serverManager.activeTranscriptions = 0;
  manager.currentDownloadProcess = { model: "large" };
  assert.equal((await manager.deleteWhisperModel("large")).success, false);
  await fs.access(model);
  assert.equal(manager.stopped, undefined);
});
