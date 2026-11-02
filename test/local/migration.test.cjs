const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const Sqlite = require("better-sqlite3");
const { ClassicLevel } = require("classic-level");
const { migrate } = require("../../src/local/profileMigration.cjs");
test("profile migration backs up before importing and excludes sessions and cloud credentials", async (t) => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "wl-profile-"));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const source = path.join(temp, "old"),
    target = path.join(temp, "new");
  await fs.mkdir(path.join(source, "Local Storage", "leveldb"), { recursive: true });
  const level = new ClassicLevel(path.join(source, "Local Storage", "leveldb"), {
    keyEncoding: "buffer",
    valueEncoding: "buffer",
  });
  await level.open();
  for (const [k, v] of Object.entries({
    whisperModel: "turbo",
    dictationKey: "Alt+R",
    whisperIdleTimeoutSeconds: "30",
    sessionToken: "private-session",
    openaiApiKey: "private-provider-key",
  }))
    await level.put(Buffer.from("_file://\x00\x01" + k), Buffer.from("\x01" + v));
  await level.close();
  const db = new Sqlite(path.join(source, "transcriptions.db"));
  db.exec(
    "CREATE TABLE notes(id INTEGER PRIMARY KEY, title TEXT, account_id TEXT, cloud_id TEXT, share_token TEXT); INSERT INTO notes VALUES(1,'Note locale','old-user','remote-id','old-share');"
  );
  db.close();
  await fs.writeFile(path.join(source, "Cookies"), "do not import");
  await fs.writeFile(
    path.join(source, ".env"),
    "LOCAL_WHISPER_MODEL=turbo\nDICTATION_KEY=Alt+R\nOPENAI_API_KEY=private-provider-key\n"
  );
  const result = await migrate({ source, target, backupRoot: path.join(temp, "backups") });
  assert.ok(await fs.stat(result.backup));
  assert.equal((await fs.stat(result.backup)).mode & 0o077, 0);
  const prefs = JSON.parse(
    await fs.readFile(path.join(target, "renderer-preferences.json"), "utf8")
  );
  assert.equal(prefs.whisperModel, "turbo");
  assert.equal(prefs.whisperIdleTimeoutSeconds, "30");
  assert.equal(prefs.dictationKey, "Alt+R");
  assert.equal(prefs.sessionToken, undefined);
  assert.equal(prefs.openaiApiKey, undefined);
  await assert.rejects(fs.access(path.join(target, "Cookies")));
  const env = await fs.readFile(path.join(target, ".env"), "utf8");
  assert.match(env, /DICTATION_KEY/);
  assert.doesNotMatch(env, /OPENAI|private-provider/);
  const migrated = new Sqlite(path.join(target, "transcriptions.db"));
  assert.deepEqual(migrated.prepare("SELECT title,account_id,cloud_id FROM notes").get(), {
    title: "Note locale",
    account_id: null,
    cloud_id: null,
  });
  migrated.close();
  const original = new Sqlite(path.join(source, "transcriptions.db"));
  assert.equal(original.prepare("SELECT account_id FROM notes").get().account_id, "old-user");
  original.close();
  await assert.rejects(
    migrate({ source, target, backupRoot: path.join(temp, "backups") }),
    /already exists/
  );
});

test("migration preserves private space and colliding account/team folders without losing contents", () => {
  const { scrubDatabase } = require("../../src/local/profileMigration.cjs");
  const db = new Sqlite(":memory:");
  try {
    db.exec(`
   CREATE TABLE spaces(id INTEGER PRIMARY KEY,kind TEXT NOT NULL CHECK(kind IN ('private','team')),name TEXT NOT NULL,cloud_team_id TEXT);
   INSERT INTO spaces VALUES(11,'private','Personal',NULL),(22,'team','Team','remote-team');
   CREATE TABLE folders(id INTEGER PRIMARY KEY,name TEXT NOT NULL,space_id INTEGER REFERENCES spaces(id),account_id TEXT,deleted_at TEXT);
   CREATE UNIQUE INDEX idx_folders_space_legacy_name ON folders(space_id,name) WHERE deleted_at IS NULL AND account_id IS NULL;
   CREATE UNIQUE INDEX idx_folders_space_account_name ON folders(space_id,account_id,name) WHERE deleted_at IS NULL AND account_id IS NOT NULL;
   INSERT INTO folders VALUES(1,'Notes',11,'account-a',NULL),(2,'Notes',11,'account-b',NULL),(3,'Notes',22,'account-a',NULL),(4,'Notes (imported 2)',11,NULL,NULL);
   CREATE TABLE notes(id INTEGER PRIMARY KEY,title TEXT,folder_id INTEGER REFERENCES folders(id),space_id INTEGER REFERENCES spaces(id),account_id TEXT);
   INSERT INTO notes VALUES(1,'First',1,11,'account-a'),(2,'Second',2,11,'account-b'),(3,'Team content',3,22,'account-a');
   CREATE TABLE agent_conversations(id INTEGER PRIMARY KEY,folder_id INTEGER REFERENCES folders(id),space_id INTEGER REFERENCES spaces(id),account_id TEXT);
   INSERT INTO agent_conversations VALUES(1,3,22,'account-a'),(2,NULL,11,'account-a'),(3,NULL,NULL,NULL);
  `);
    scrubDatabase(db);
    assert.deepEqual(db.prepare("SELECT id,kind FROM spaces").all(), [{ id: 11, kind: "private" }]);
    const folders = db.prepare("SELECT id,name,space_id,account_id FROM folders ORDER BY id").all();
    assert.equal(folders.length, 4);
    assert.equal(new Set(folders.map((row) => row.name)).size, 4);
    assert.ok(folders.every((row) => row.space_id === 11 && row.account_id === null));
    assert.equal(folders[3].name, "Notes (imported 2)");
    assert.deepEqual(
      db.prepare("SELECT id,title,folder_id,space_id,account_id FROM notes ORDER BY id").all(),
      [
        { id: 1, title: "First", folder_id: 1, space_id: 11, account_id: null },
        { id: 2, title: "Second", folder_id: 2, space_id: 11, account_id: null },
        { id: 3, title: "Team content", folder_id: 3, space_id: 11, account_id: null },
      ]
    );
    assert.deepEqual(db.prepare("SELECT id,space_id FROM agent_conversations ORDER BY id").all(), [
      { id: 1, space_id: 11 },
      { id: 2, space_id: 11 },
      { id: 3, space_id: null },
    ]);
    assert.deepEqual(db.pragma("foreign_key_check"), []);
  } finally {
    db.close();
  }
});
