import type { NavigatorConnectionLike, ServerOption, TelemetryNetworkContext } from "../types";

export function readNetworkType(): string {
  const connection = (
    navigator as Navigator & { connection?: NavigatorConnectionLike }
  ).connection;

  if (connection?.type === "wifi") return "wifi";
  if (connection?.type === "cellular") return "mobile";
  if (
    connection?.effectiveType === "slow-2g" ||
    connection?.effectiveType === "2g" ||
    connection?.effectiveType === "3g" ||
    connection?.effectiveType === "4g"
  ) {
    return "mobile";
  }

  return "unknown";
}

function readCarrier(): string | undefined {
  const connection = (
    navigator as Navigator & { connection?: NavigatorConnectionLike }
  ).connection;
  const carrier = (connection as Record<string, unknown> | undefined)?.["carrier"];
  return typeof carrier === "string" && carrier.trim().length > 0 ? carrier.trim() : undefined;
}

export function buildRouteContext(): TelemetryNetworkContext {
  const ctx: TelemetryNetworkContext = {
    networkType: readNetworkType(),
    carrier: readCarrier(),
  };

  // Strip undefined values so URLSearchParams doesn't choke
  return Object.fromEntries(
    Object.entries(ctx).filter(([_, v]) => v !== undefined).map(([k, v]) => [k, String(v)])
  ) as unknown as TelemetryNetworkContext;
}

export async function submitProbeReport(server: ServerOption) {
  const { getStoredAuthSessionId, resolveApiUrl } = await import("./http");
  const { enqueueTelemetryReport } = await import("./telemetryQueue");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const sessionId = getStoredAuthSessionId();
  if (sessionId) {
    headers["x-auth-session-id"] = sessionId;
  }
  const url = resolveApiUrl("/api/telemetry/probe");
  const body = JSON.stringify({
    endpointId: server.id,
    transportProfile: server.transportProfile,
    result: "connected",
    latencyMs: server.latencyMs,
    bytesSent: 512,
    bytesReceived: 2048,
    appVersion: "pwa-dev",
    testedAt: new Date().toISOString(),
    networkType: readNetworkType(),
  });

  try {
    const response = await fetch(url, { method: "POST", headers, body });
    if (!response.ok) {
      enqueueTelemetryReport(url, body, headers);
    }
  } catch {
    // Отправка не удалась (offline/сетевой сбой) — кэшируем локально и
    // досылаем при следующем flushTelemetryQueue(), а не теряем отчёт.
    enqueueTelemetryReport(url, body, headers);
  }
}
