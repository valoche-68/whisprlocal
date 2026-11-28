// Writes are finalized in SQLite. No cloud queue is installed in WhisprLocal.
export function syncAfterLocalWrite(
  _method: "syncDictionaryNow" | "syncSnippetsNow" | "syncSkillsNow"
): void {}
