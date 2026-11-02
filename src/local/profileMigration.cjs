const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { ClassicLevel } = require("classic-level");
const Sqlite = require("better-sqlite3");
const dotenv = require("dotenv");
const preferenceKeys = require("./profilePreferenceKeys.json");
const blocked =
  /auth|session|token|cookie|telemetry|insightsSync|cloudBackup|isSignedIn|workspace|enterprise|bedrock|azure|vertex|gcal|mcal|appleCalendar|leaderboard|referral|checkout|billing|subscription/i;
function allowedPreference(key) {
  return (
    preferenceKeys.includes(key) &&
    !blocked.test(key) &&
    (!/apiKey|secret|password/i.test(key) || /CustomApiKey/.test(key))
  );
}
async function assertClosed(profile) {
  try {
    const lock = await fs.readlink(path.join(profile, "SingletonLock"));
    const pid = Number(lock.split("-").at(-1));
    if (Number.isInteger(pid) && pid > 1) {
      try {
        process.kill(pid, 0);
        throw new Error("Close the application before migrating its profile");
      } catch (e) {
        if (e.code !== "ESRCH") throw e;
      }
    }
  } catch (e) {
    if (!["ENOENT", "EINVAL"].includes(e.code)) throw e;
  }
}
async function readPreferences(profile, temp) {
  const source = path.join(profile, "Local Storage", "leveldb");
  try {
    await fs.access(source);
  } catch {
    return {};
  }
  const copy = path.join(temp, "leveldb");
  await fs.cp(source, copy, { recursive: true });
  const db = new ClassicLevel(copy, {
    keyEncoding: "buffer",
    valueEncoding: "buffer",
    createIfMissing: false,
  });
  const result = {};
  try {
    await db.open();
    for await (const [key, value] of db.iterator()) {
      // Chromium DOMStorage encodes keys after the origin/NUL and a string encoding byte.
      const at = key.indexOf(0);
      if (key[0] !== 95 || at < 0) continue;
      const raw = key.subarray(at + 1);
      const name = raw.subarray(1).toString(raw[0] === 0 ? "utf16le" : "latin1");
      if (!allowedPreference(name)) continue;
      result[name] = value.subarray(1).toString(value[0] === 0 ? "utf16le" : "latin1");
    }
  } finally {
    await db.close();
  }
  return result;
}
function scrubDatabase(db) {
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table'")
    .all()
    .map((t) => t.name);
  db.pragma("foreign_keys = OFF");
  db.pragma("secure_delete = ON");
  db.transaction(() => {
    for (const table of [
      "google_calendar_tokens",
      "microsoft_calendar_tokens",
      "google_calendars",
      "microsoft_calendars",
      "apple_calendars",
      "calendar_events",
      "connector_actions",
      "space_accounts",
      "analytics_clear_requests",
    ])
      if (tables.includes(table)) db.exec(`DELETE FROM "${table}"`);
    for (const table of [
      "notes",
      "folders",
      "agent_conversations",
      "transcriptions",
      "custom_dictionary",
      "snippets",
      "analytics_events",
    ]) {
      if (!tables.includes(table)) continue;
      const cols = db
        .prepare(`PRAGMA table_info("${table}")`)
        .all()
        .map((c) => c.name);
      for (const col of [
        "account_id",
        "cloud_id",
        "share_token",
        "updated_by_user_id",
        "owner_user_id",
        "created_by_user_id",
      ])
        if (cols.includes(col)) db.exec(`UPDATE "${table}" SET "${col}"=NULL`);
      if (cols.includes("is_shared")) db.exec(`UPDATE "${table}" SET is_shared=0`);
    }
    // Team and account spaces are not an offline service. Local personal rows survive.
    if (tables.includes("spaces")) {
      const ids = db
        .prepare("SELECT id FROM spaces WHERE kind != 'personal'")
        .all()
        .map((r) => r.id);
      for (const id of ids)
        for (const table of ["notes", "folders", "agent_conversations"])
          if (tables.includes(table))
            db.prepare(`UPDATE "${table}" SET space_id=NULL WHERE space_id=?`).run(id);
      db.exec("DELETE FROM spaces WHERE kind != 'personal'");
      const cols = db
        .prepare("PRAGMA table_info(spaces)")
        .all()
        .map((c) => c.name);
      for (const col of ["cloud_team_id", "workspace_id", "cloud_space_id"])
        if (cols.includes(col)) db.exec(`UPDATE spaces SET "${col}"=NULL`);
    }
  })();
  db.exec("VACUUM");
}
async function migrate({
  source,
  target,
  backupRoot = path.join(os.homedir(), ".local", "state", "whisprlocal", "backups"),
}) {
  source = path.resolve(source);
  target = path.resolve(target);
  if (source === target) throw new Error("Use a distinct WhisprLocal profile");
  await assertClosed(source);
  await assertClosed(target);
  try {
    await fs.access(target);
    throw new Error("Destination profile already exists; no data was overwritten");
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  await fs.mkdir(backupRoot, { recursive: true, mode: 0o700 });
  await fs.chmod(backupRoot, 0o700);
  const backup = path.join(backupRoot, stamp);
  await fs.cp(source, backup, { recursive: true });
  await fs.chmod(backup, 0o700);
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "whisprlocal-migration-"));
  await fs.chmod(temp, 0o700);
  const staged = path.join(temp, "profile");
  await fs.mkdir(staged, { mode: 0o700 });
  let createdTarget = false;
  try {
    const preferences = await readPreferences(backup, temp);
    const selfHosted = Object.values(preferences).includes("self-hosted");
    if (!selfHosted)
      for (const key of Object.keys(preferences))
        if (/ApiKey|secret/i.test(key)) delete preferences[key];
    await fs.writeFile(
      path.join(staged, "renderer-preferences.json"),
      JSON.stringify(preferences),
      { mode: 0o600 }
    );
    const dbFile = path.join(backup, "transcriptions.db");
    try {
      await fs.access(dbFile);
      const db = new Sqlite(dbFile, { readonly: true });
      await db.backup(path.join(staged, "transcriptions.db"));
      db.close();
      const migrated = new Sqlite(path.join(staged, "transcriptions.db"));
      scrubDatabase(migrated);
      migrated.close();
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    for (const dir of ["audio", "bin"])
      try {
        await fs.cp(path.join(backup, dir), path.join(staged, dir), { recursive: true });
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
      }
    let env = {};
    try {
      env = dotenv.parse(await fs.readFile(path.join(backup, ".env")));
    } catch {}
    const allowed =
      /^(?:LOCAL_|WHISPER_|PARAKEET_|COHERE_|LLAMA_|DICTATION_|VOICE_AGENT_KEY$|TRANSLATION_KEY$|MEETING_KEY$|ACTIVATION_MODE$|FLOATING_ICON_AUTO_HIDE$|PANEL_START_POSITION$|START_MINIMIZED$|UI_LANGUAGE$|TRANSCRIPTION_GPU_UUID$|INTELLIGENCE_GPU_UUID$)/;
    const lines = Object.entries(env)
      .filter(
        ([k]) =>
          (allowed.test(k) && !/KEY$/.test(k)) ||
          ["DICTATION_KEY", "VOICE_AGENT_KEY", "TRANSLATION_KEY", "MEETING_KEY"].includes(k)
      )
      .map(([k, v]) => `${k}=${JSON.stringify(v)}`);
    await fs.writeFile(path.join(staged, ".env"), lines.join("\n") + "\n", { mode: 0o600 });
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.mkdir(target, { mode: 0o700 });
    createdTarget = true;
    for (const entry of await fs.readdir(staged)) {
      await fs.cp(path.join(staged, entry), path.join(target, entry), {
        recursive: true,
        errorOnExist: true,
        force: false,
      });
    }
    await fs.chmod(target, 0o700);
    const report = {
      backup,
      target,
      preferenceCount: Object.keys(preferences).length,
      modelsReused: true,
      excluded: [
        "cookies",
        "account sessions",
        "cloud provider credentials",
        "official synchronization state",
        "logs",
      ],
    };
    await fs.writeFile(
      path.join(target, "migration-report.json"),
      JSON.stringify(report, null, 2),
      { mode: 0o600 }
    );
    return report;
  } catch (e) {
    if (createdTarget) await fs.rm(target, { recursive: true, force: true });
    throw e;
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
}
module.exports = { migrate, readPreferences, allowedPreference, scrubDatabase };
