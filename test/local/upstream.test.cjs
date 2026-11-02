const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { prepareMigration } = require("../../scripts/whisprlocal/prepare-upstream.cjs");
function fixture(t, conflict) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wl-merge-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const git = (...args) => {
    const r = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
  };
  git("init", "-b", "main");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.invalid");
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "open-whispr", version: "1.0.0" }, null, 2) + "\n"
  );
  fs.writeFileSync(
    path.join(dir, "package-lock.json"),
    JSON.stringify({ version: "1.0.0", packages: { "": { version: "1.0.0" } } }, null, 2) + "\n"
  );
  fs.writeFileSync(path.join(dir, "feature.txt"), "initial\n");
  git("add", ".");
  git("commit", "-m", "upstream base");
  const base = git("rev-parse", "HEAD");
  git("switch", "-c", "vendor");
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "open-whispr", version: "1.1.0" }, null, 2) + "\n"
  );
  fs.writeFileSync(path.join(dir, "improvement.txt"), "official improvement");
  if (conflict)
    fs.writeFileSync(path.join(dir, "feature.txt"), "incompatible upstream implementation\n");
  git("add", ".");
  git("commit", "-m", "upstream update");
  git("tag", "v1.1.0");
  git("switch", "main");
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "whisprlocal", version: "0.1.0" }, null, 2) + "\n"
  );
  fs.writeFileSync(
    path.join(dir, "upstream.json"),
    JSON.stringify({ version: "1.0.0", tag: "v1.0.0", commit: base })
  );
  fs.writeFileSync(path.join(dir, "feature.txt"), "local idle unload and privacy\n");
  git("add", ".");
  git("commit", "-m", "local edition");
  return dir;
}
test("upstream migration preserves identity and local features while importing a clean update", (t) => {
  const repo = fixture(t, false);
  const result = prepareMigration(repo, "v1.1.0");
  assert.deepEqual(result.conflicts, []);
  assert.equal(JSON.parse(fs.readFileSync(path.join(repo, "package.json"))).version, "0.1.0");
  assert.equal(
    fs.readFileSync(path.join(repo, "feature.txt"), "utf8"),
    "local idle unload and privacy\n"
  );
  assert.ok(fs.existsSync(path.join(repo, "improvement.txt")));
  assert.equal(JSON.parse(fs.readFileSync(path.join(repo, "upstream.json"))).version, "1.1.0");
});
test("upstream conflicts create a blocking report and never resolve local features away", (t) => {
  const repo = fixture(t, true);
  const result = prepareMigration(repo, "v1.1.0");
  assert.ok(result.conflicts.includes("feature.txt"));
  assert.ok(fs.existsSync(path.join(repo, ".github/upstream-conflicts/v1.1.0.md")));
  assert.equal(
    fs.readFileSync(path.join(repo, "feature.txt"), "utf8"),
    "local idle unload and privacy\n"
  );
  assert.equal(JSON.parse(fs.readFileSync(path.join(repo, "upstream.json"))).version, "1.0.0");
});

test("upstream migration works on a clean CI checkout without a configured Git identity", (t) => {
  const repo = fixture(t, false);
  for (const key of ["user.name", "user.email"]) {
    const removed = spawnSync("git", ["config", "--unset", key], { cwd: repo });
    assert.equal(removed.status, 0);
  }
  const script = require.resolve("../../scripts/whisprlocal/prepare-upstream.cjs");
  const migrated = spawnSync(process.execPath, [script, "v1.1.0"], {
    cwd: repo,
    encoding: "utf8",
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" },
  });
  assert.equal(migrated.status, 0, migrated.stderr);
  assert.deepEqual(JSON.parse(migrated.stdout).conflicts, []);
  assert.ok(fs.existsSync(path.join(repo, "improvement.txt")));
});
