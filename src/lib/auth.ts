/** Compatibility for upstream components excluded from the local edition. No auth SDK. */
export const AUTH_URL = "";
export const ADMIN_URL = "";
const unavailable = async (..._args: unknown[]) => ({
  error: Object.assign(new Error("Accounts are not available in WhisprLocal"), {
    code: "LOCAL_ONLY",
  }),
});
export const authClient = {
  signIn: { social: unavailable, email: unavailable, sso: unavailable },
  signUp: { email: unavailable },
  signOut: unavailable,
  sendVerificationEmail: unavailable,
  getSession: async () => ({ data: null, error: null }),
  updateUser: unavailable,
  changePassword: unavailable,
  listAccounts: async (..._args: unknown[]) => ({ data: [], error: null }),
  $fetch: unavailable,
  $store: { notify: (..._args: unknown[]) => {} },
};
export type SocialProvider = "google" | "microsoft" | "apple";
export interface AuthActionError extends Error {
  code?: string;
}
export const signInWithSocial = unavailable;
export const signInWithSSO = unavailable;
export const requestPasswordReset = unavailable;
export const updateDisplayName = unavailable;
export const changePassword = unavailable;
export const signOut = async () => {};
export const openAdminConsole = async () => {};
export const hasCredentialAccount = async () => false;
export const updateLastSignInTime = () => {};
export const isWithinGracePeriod = () => false;
export const getGracePeriodRemainingMs = () => 0;
export async function withSessionRefresh<T>(operation: () => Promise<T>): Promise<T> {
  return operation();
}
