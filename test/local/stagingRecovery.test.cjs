const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const tar = require("tar");
const { stageArchive, switchVersion } = require("../../src/local/archiveUpdates.cjs");

test("retry after lost staging state extracts fresh bytes and preserves rollback", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "wl-recovery-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const source = path.join(dir, "source");
  await fs.mkdir(source);
  await fs.writeFile(path.join(source, "whisprlocal"), "verified new executable", { mode: 0o755 });
  const archive = path.join(dir, "update.tar.gz");
  await tar.c({ file: archive, cwd: source, gzip: true }, ["whisprlocal"]);
  const base = path.join(dir, "install");
  const first = await stageArchive(archive, base, "0.1.1");
  await switchVersion(base, first);
  const next = await stageArchive(archive, base, "0.1.1");
  assert.notEqual(next, first);
  assert.equal(await fs.realpath(path.join(base, "current")), first);
  assert.equal(await fs.readFile(path.join(first, "whisprlocal"), "utf8"), "verified new executable");
  assert.equal(await fs.readFile(path.join(next, "whisprlocal"), "utf8"), "verified new executable");
});
