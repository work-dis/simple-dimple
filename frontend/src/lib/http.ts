export class HttpError extends Error {
  status: number;

  constructor(status: number) {
    super(`Request failed with status ${status}`);
    this.status = status;
  }
}

const authSessionStorageKey = "simple-dimple.auth-session-id";

export function getStoredAuthSessionId() {
  if (typeof window === "undefined") {
    return null;
  }

  const value = window.localStorage.getItem(authSessionStorageKey);
  return value && value.trim().length > 0 ? value : null;
}

export function setStoredAuthSessionId(sessionId: string | null | undefined) {
  if (typeof window === "undefined") {
    return;
  }

  const trimmedSessionId = typeof sessionId === "string" ? sessionId.trim() : "";

  if (!trimmedSessionId) {
    window.localStorage.removeItem(authSessionStorageKey);
    return;
  }

  window.localStorage.setItem(authSessionStorageKey, trimmedSessionId);
}

export async function readJson<T>(
  input: RequestInfo,
  init?: RequestInit,
): Promise<T> {
  const headers = new Headers(init?.headers);
  const authSessionId = getStoredAuthSessionId();

  if (authSessionId) {
    headers.set("x-auth-session-id", authSessionId);
  }

  const response = await fetch(input, {
    ...init,
    headers,
  });

  if (!response.ok) {
    throw new HttpError(response.status);
  }

  return response.json() as Promise<T>;
}
