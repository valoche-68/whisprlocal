const test = require("node:test");
const assert = require("node:assert/strict");
const { createDb } = require("./harness/db.js");
const { scrubDatabase } = require("../../src/local/profileMigration.cjs");

test("an imported 1.12 profile exposes its contents without an account", (t) => {
  const database = createDb(t);
  if (!database) return;
  const sqlite = database.db;

  for (const owner of ["alice", "bob"]) {
    database.setActiveAccountId(owner);
    database.saveTranscription(`Dictée ${owner}`);
    database.applyDictionaryChanges({ add: ["Whisper"] });
    database.setSnippets([{ trigger: "adr", replacement: `Adresse ${owner}` }]);
    sqlite.prepare(
      "INSERT INTO spaces (kind, name, account_id, workspace_id) VALUES ('private', 'Personal', ?, ?)"
    ).run(owner, `workspace-${owner}`);
    const space = sqlite.prepare("SELECT id FROM spaces WHERE account_id=?").get(owner);
    sqlite.prepare("INSERT INTO folders (name, space_id, account_id) VALUES ('Notes', ?, ?)")
      .run(space.id, owner);
    const folder = sqlite.prepare("SELECT id FROM folders WHERE space_id=?").get(space.id);
    sqlite.prepare("INSERT INTO notes (title, space_id, folder_id, account_id) VALUES (?, ?, ?, ?)")
      .run(`Note ${owner}`, space.id, folder.id, owner);
    database.createAgentConversation(`Discussion ${owner}`, null, space.id, folder.id);
  }
  database.setActiveAccountId(null);
  const localSpace = database.getSpaces()[0].id;

  scrubDatabase(sqlite);

  assert.deepEqual(database.getSpaces().map(({ id }) => id), [localSpace]);
  assert.deepEqual(database.getNotes().map(({ title }) => title).sort(), ["Note alice", "Note bob"]);
  const folders = database.getFolders().filter(({ name }) => /^Notes(?: \(imported \d+\))?$/.test(name));
  assert.equal(new Set(folders.map(({ name }) => name)).size, 2);
  assert.deepEqual(database.getTranscriptions().map(({ text }) => text).sort(), [
    "Dictée alice", "Dictée bob",
  ]);
  assert.deepEqual(database.getDictionary(), ["Whisper"]);
  assert.deepEqual(database.getSnippets().map(({ replacement }) => replacement).sort(), [
    "Adresse alice", "Adresse bob",
  ]);
  assert.deepEqual(sqlite.prepare(
    "SELECT title, space_id FROM agent_conversations ORDER BY title"
  ).all(), [
    { title: "Discussion alice", space_id: localSpace },
    { title: "Discussion bob", space_id: localSpace },
  ]);
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM device_accounts").get().n, 0);
  assert.deepEqual(sqlite.pragma("foreign_key_check"), []);
});
