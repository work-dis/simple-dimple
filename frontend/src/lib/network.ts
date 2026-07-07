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

export function buildRouteContext(): TelemetryNetworkContext {
  return { networkType: readNetworkType() };
}

export async function submitProbeReport(server: ServerOption) {
  try {
    await fetch("/api/telemetry/probe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        endpointId: server.id,
        transportProfile: server.transportProfile,
        result: "connected",
        latencyMs: server.latencyMs,
        bytesSent: 512,
        bytesReceived: 2048,
        appVersion: "pwa-dev",
        testedAt: new Date().toISOString(),
        networkType: readNetworkType(),
      }),
    });
  } catch {
    // Best-effort telemetry
  }
}
