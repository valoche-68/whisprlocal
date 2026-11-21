// Compatibility for upstream components excluded from the local edition.
export interface DataWrap<T> {
  data: T;
}

export class CloudApiError extends Error {
  status: number;
  code?: string;
  details?: unknown;
  requestSent?: boolean;
  constructor(
    message: string,
    status: number,
    code?: string,
    details?: unknown,
    requestSent?: boolean
  ) {
    super(message);
    this.name = "CloudApiError";
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestSent = requestSent;
  }
}

export function serverRefusalMessage(error: unknown): string | null {
  if (!(error instanceof CloudApiError)) return null;
  const { status, message } = error;
  if (status < 400 || status >= 500 || status === 401 || message === `API error: ${status}`) {
    return null;
  }
  return message;
}

async function cloudRequest<T = unknown>(..._args: unknown[]): Promise<T> {
  throw new CloudApiError(
    "Accounts and official services are unavailable in WhisprLocal",
    0,
    "LOCAL_ONLY",
    undefined,
    false
  );
}

export async function cloudGet<T = unknown>(path: string, _cache?: "no-store"): Promise<T> {
  return cloudRequest<T>("GET", path);
}

// Account-scoped work may wait behind another renderer operation. Preserve the
// credential generation from the caller so a queued request cannot adopt a
// replacement account's token when it eventually reaches the main process.
export async function cloudGetForAuthGeneration<T = unknown>(
  path: string,
  authGeneration: number,
  _cache?: "no-store"
): Promise<T> {
  return cloudRequest<T>("GET", path, undefined, false, authGeneration);
}

// Account-scope bootstrap is the only authenticated call allowed before the
// candidate session generation has been committed for ordinary sync.
export async function cloudGetForAuthValidation<T = unknown>(
  path: "/api/me/spaces",
  generation: number
): Promise<T> {
  return cloudRequest<T>("GET", path, undefined, false, generation);
}

// For endpoints that work without a session (e.g. invitation previews).
export async function cloudGetPublic<T = unknown>(path: string): Promise<T> {
  return cloudRequest<T>("GET", path, undefined, true);
}

export async function cloudPost<T = unknown>(path: string, body?: unknown): Promise<T> {
  return cloudRequest<T>("POST", path, body);
}

export async function cloudPostForAuthGeneration<T = unknown>(
  path: string,
  body: unknown,
  authGeneration: number
): Promise<T> {
  return cloudRequest<T>("POST", path, body, false, authGeneration);
}

export async function cloudPatch<T = unknown>(path: string, body?: unknown): Promise<T> {
  return cloudRequest<T>("PATCH", path, body);
}

export async function cloudPatchForAuthGeneration<T = unknown>(
  path: string,
  body: unknown,
  authGeneration: number
): Promise<T> {
  return cloudRequest<T>("PATCH", path, body, false, authGeneration);
}

export async function cloudDelete<T = unknown>(path: string, body?: unknown): Promise<T> {
  return cloudRequest<T>("DELETE", path, body);
}

export async function cloudDeleteForAuthGeneration<T = unknown>(
  path: string,
  body: unknown,
  authGeneration: number
): Promise<T> {
  return cloudRequest<T>("DELETE", path, body, false, authGeneration);
}

export function isAuthContextError(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) return false;
  const code = (error as { code?: unknown }).code;
  return code === "AUTH_CONTEXT_CHANGED" || code === "AUTH_CONTEXT_UNVALIDATED";
}

export function wasRefusedBeforeSending(error: unknown): boolean {
  return error instanceof CloudApiError && isAuthContextError(error) && error.requestSent === false;
}
