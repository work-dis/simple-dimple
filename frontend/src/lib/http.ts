import { Capacitor } from "@capacitor/core";

export class HttpError extends Error {
  status: number;

  constructor(status: number) {
    super(`Request failed with status ${status}`);
    this.status = status;
  }
}

// В браузере/PWA "/api/..." резолвится относительно текущего origin (dev —
// через vite-proxy, prod — через nginx на одном хосте с бэкендом). В нативном
// Capacitor-приложении WebView грузит бандл локально, у относительного пути
// нет бэкенда за ним — нужен абсолютный control-plane URL.
const nativeApiBaseUrl = "https://57.128.220.83";

export function resolveApiUrl(path: string): string {
  if (Capacitor.isNativePlatform() && path.startsWith("/")) {
    return `${nativeApiBaseUrl}${path}`;
  }
  return path;
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

  const resolvedInput = typeof input === "string" ? resolveApiUrl(input) : input;

  const response = await fetch(resolvedInput, {
    ...init,
    headers,
  });

  if (!response.ok) {
    throw new HttpError(response.status);
  }

  return response.json() as Promise<T>;
}
