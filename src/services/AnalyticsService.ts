import type { AnalyticsSummary } from "../types/electron";
export const ANALYTICS_SUMMARY_REFRESH_INTERVAL_MS = 300000;
export const ANALYTICS_REMOTE_REFRESH_DEBOUNCE_MS = 250;
export function subscribeToAnalyticsRefresh(
  refresh: (dataChanged: boolean) => void | Promise<void>,
  _remote?: boolean
): () => void {
  void refresh(true);
  return (
    window.electronAPI.onAnalyticsChanged?.(() => {
      void refresh(true);
    }) ?? (() => {})
  );
}
export async function syncPendingAnalytics(..._args: unknown[]): Promise<number> {
  return 0;
}
export async function hasPendingAnalyticsErasures(..._args: unknown[]): Promise<boolean> {
  return false;
}
export async function getAccountAnalyticsSummary(..._args: unknown[]): Promise<AnalyticsSummary> {
  throw new Error("Account analytics do not exist in WhisprLocal; use local statistics");
}
