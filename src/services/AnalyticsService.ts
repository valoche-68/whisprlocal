import type { AnalyticsSummary } from "../types/electron";
export const ANALYTICS_SUMMARY_REFRESH_INTERVAL_MS = 300000;
export const ANALYTICS_REMOTE_REFRESH_DEBOUNCE_MS = 250;
export function subscribeToAnalyticsRefresh(
  refresh: () => void | Promise<void>,
  _remote?: boolean
): () => void {
  void refresh();
  return (
    window.electronAPI.onAnalyticsChanged?.(() => {
      void refresh();
    }) ?? (() => {})
  );
}
export async function syncPendingAnalytics(..._args: unknown[]): Promise<number> {
  return 0;
}
export async function getAccountAnalyticsSummary(..._args: unknown[]): Promise<AnalyticsSummary> {
  throw new Error("Account analytics do not exist in WhisprLocal; use local statistics");
}
