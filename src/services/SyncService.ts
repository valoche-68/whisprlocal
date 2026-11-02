/** Local writes remain in SQLite. No account synchronizer is included. */
class LocalPersistence {
  canSync(..._args: unknown[]) {
    return false;
  }
  startAutoSync() {}
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
  async syncAnalyticsNow(..._args: unknown[]) {
    return 0;
  }
  async syncDictionaryNow(..._args: unknown[]) {}
  async syncSharedDictionaryNow(..._args: unknown[]) {
    return "synced" as const;
  }
  async syncSnippetsNow(..._args: unknown[]) {}
}
export const syncService = new LocalPersistence();

export async function markSpacePurged(..._args: unknown[]) {}
export async function upsertCloudSpaces(..._args: unknown[]) {}
