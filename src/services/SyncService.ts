/** Local writes remain in SQLite. No account synchronizer is included. */
export type DictionarySyncResult = "synced" | "skipped" | "failed";

class LocalPersistence {
  canSync(..._args: unknown[]) {
    return false;
  }
  startAutoSync() {}
  forgetAccount(..._args: unknown[]) {}
  setNoteOpen(..._args: unknown[]) {}
  requestSyncAll(..._args: unknown[]) {}
  debouncedPush(..._args: unknown[]) {}
  async ensureNoteSynced(..._args: unknown[]): Promise<string | null> {
    return null;
  }
  async purgeTeamSpacesForSignOut() {}
  async verifyTeamSpacesForAccount(..._args: unknown[]) {
    return 0;
  }
  async syncAnalyticsNow(..._args: unknown[]): Promise<boolean> {
    return false;
  }
  async syncDictionaryNow(..._args: unknown[]): Promise<DictionarySyncResult> {
    return "skipped";
  }
  async syncSharedDictionaryNow(..._args: unknown[]): Promise<DictionarySyncResult> {
    return "skipped";
  }
  async syncSnippetsNow(..._args: unknown[]) {}
}
export const syncService = new LocalPersistence();

export async function markSpacePurged(..._args: unknown[]) {}
export async function releasePurgedSpace(..._args: unknown[]) {}
export async function upsertCloudSpaces(..._args: unknown[]): Promise<number[]> {
  return [];
}
