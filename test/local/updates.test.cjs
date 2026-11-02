const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const tar = require("tar");
const crypto = require("node:crypto");
const {
  safeEntry,
  stageArchive,
  switchVersion,
  rollback,
  releaseInfo,
  downloadVerified,
} = require("../../src/local/archiveUpdates.cjs");
test("unpacked upgrade stages, switches and rolls back without touching the profile", async (t) => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "wl-update-"));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const base = path.join(temp, "install");
  const old = path.join(base, "versions", "0.1.0");
  await fs.mkdir(old, { recursive: true });
  await fs.writeFile(path.join(old, "whisprlocal"), "old");
  await fs.symlink(old, path.join(base, "current"));
  const profile = path.join(temp, "profile");
  await fs.mkdir(profile);
  await fs.writeFile(path.join(profile, "settings.json"), "keep");
  const source = path.join(temp, "source");
  await fs.mkdir(source);
  await fs.writeFile(path.join(source, "whisprlocal"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  const file = path.join(temp, "update.tar.gz");
  await tar.c({ file, cwd: source, gzip: true }, ["whisprlocal"]);
  const target = await stageArchive(file, base, "0.1.1");
  assert.equal(await fs.realpath(path.join(base, "current")), old);
  await switchVersion(base, target);
  assert.equal(await fs.realpath(path.join(base, "current")), target);
  await rollback(base);
  assert.equal(await fs.realpath(path.join(base, "current")), old);
  assert.equal(await fs.readFile(path.join(profile, "settings.json"), "utf8"), "keep");
  await assert.rejects(stageArchive(file, base, "0.1.1"), /already staged/);
  await assert.rejects(switchVersion(base, temp), /outside/);
});
test("archive traversal and escaping links are refused", () => {
  for (const entry of [
    { path: "../../x", type: "File" },
    { path: "/etc/x", type: "File" },
    { path: "safe/link", type: "SymbolicLink", linkpath: "../../x" },
    { path: "safe/socket", type: "Socket" },
  ])
    assert.equal(safeEntry(entry), false);
  assert.equal(safeEntry({ path: "app/lib.so", type: "SymbolicLink", linkpath: "lib.so.1" }), true);
});
test("updates use the independent stable feed and verify SHA256 before staging", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "wl-hash-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const data = Buffer.from("test artifact");
  const name = "WhisprLocal-0.1.1-linux-x64.tar.gz";
  const prefix = "https://github.com/valoche-68/whisprlocal/releases/download/v0.1.1/";
  const info = {
    version: "0.1.1",
    assets: [
      { name, size: data.length, browser_download_url: prefix + name },
      { name: "SHA256SUMS", browser_download_url: prefix + "SHA256SUMS" },
    ],
  };
  const good = crypto.createHash("sha256").update(data).digest("hex");
  let sum = good;
  const fetch = async (u) => new Response(u.endsWith("SHA256SUMS") ? `${sum}  ${name}\n` : data);
  const file = await downloadVerified(fetch, info, "tar.gz", dir);
  assert.deepEqual(await fs.readFile(file), data);
  sum = "0".repeat(64);
  await assert.rejects(downloadVerified(fetch, info, "tar.gz", dir), /checksum mismatch/);
  let requested;
  assert.equal(
    await releaseInfo(async (u) => {
      requested = u;
      return new Response("", { status: 404 });
    }, "0.1.0"),
    null
  );
  assert.equal(requested, "https://api.github.com/repos/valoche-68/whisprlocal/releases/latest");
});
