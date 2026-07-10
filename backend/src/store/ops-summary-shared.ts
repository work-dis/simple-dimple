import type { RouteReprobeJob } from "../generated/prisma/client.js";
import type {
  RouteDecisionOpsEventSummary,
  RouteReprobeJobAttemptAuditEntry,
  TelemetryFailureReason,
  TelemetryNetworkContext
} from "../types.js";

// --------------------------------------------------------------------------
// Shared helpers for the route-decision-ops summary builders
// (route-reprobe-execution-summary.ts, route-decision-ops.ts)
// --------------------------------------------------------------------------

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function asFailureReason(value: unknown): TelemetryFailureReason | null {
  return value === "timeout" ||
    value === "handshake_failed" ||
    value === "connect_refused" ||
    value === "dns_blocked" ||
    value === "captive_portal" ||
    value === "packet_loss_suspected" ||
    value === "tls_error" ||
    value === "unknown"
    ? value
    : null;
}

export function readMetadataValue(metadata: unknown, key: string) {
  return isRecord(metadata) ? metadata[key] : undefined;
}

export function readEventSource(metadata: unknown): RouteDecisionOpsEventSummary["source"] {
  const source = readMetadataValue(metadata, "source");
  return source === "resolve" || source === "connect" || source === "runtime_reprobe" || source === "manual_report"
    ? source
    : null;
}

export function readNullableString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

export function readNullableNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function median(values: number[]) {
  if (!values.length) {
    return null;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const midpoint = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 1) {
    return sorted[midpoint];
  }

  return Number(((sorted[midpoint - 1] + sorted[midpoint]) / 2).toFixed(1));
}

export function percentile(values: number[], ratio: number) {
  if (!values.length) {
    return null;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return sorted[index];
}

export function minutesBetween(start: Date, end: Date) {
  return Number(((end.getTime() - start.getTime()) / 60000).toFixed(1));
}

export function floorToWindow(date: Date, windowSizeMinutes: number) {
  const windowMs = windowSizeMinutes * 60 * 1000;
  return new Date(Math.floor(date.getTime() / windowMs) * windowMs);
}

export function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

export function buildNetworkContextKey(input: {
  networkFingerprintId?: string | null;
  networkType?: string | null;
  carrier?: string | null;
  asn?: number | null;
  countryCode?: string | null;
  region?: string | null;
}) {
  return [
    input.networkType ?? "unknown",
    input.carrier ?? "unknown",
    input.asn ?? "unknown",
    input.countryCode ?? "unknown",
    input.region ?? "unknown"
  ].join(":");
}

export function isFallbackRecommendation(reason: string | null) {
  return Boolean(reason && reason !== "network_ranking_primary" && reason !== "manual_override");
}

export function formatDomainLabel(domainType: "provider" | "asn", domainKey: string) {
  return domainType === "provider" ? domainKey : `ASN ${domainKey}`;
}

export const opsRetentionPolicy = {
  probeReportsDays: 45,
  routeEventsDays: 45,
  routeReprobeJobsDays: 14,
  routeSuccessRollupsDays: 180,
  routeRankingsDays: 180
} as const;

export type RouteDecisionOpsEventRecord = {
  id: string;
  occurredAt: Date;
  endpointId: string | null;
  networkFingerprintId: string | null;
  eventType: string;
  feedbackResult: string | null;
  eventReason: string | null;
  metadata: unknown;
  transportProfile: string;
  endpoint: {
    id: string;
    label: string;
    provider: string;
    asn: number | null;
    transportProfile: string;
    city: string | null;
    countryCode: string;
    serverPool: {
      region: string | null;
    } | null;
  } | null;
  networkFingerprint: {
    id: string;
    networkType: string | null;
    carrier: string | null;
    asn: number | null;
    countryCode: string | null;
    region: string | null;
  } | null;
};

export type DegradationWindow = {
  endpointId: string | null;
  networkFingerprintId: string | null;
  networkContextKey: string;
  provider: string | null;
  endpointAsn: number | null;
  startedAt: Date;
  resolvedAt?: Date;
};

export type InventoryEndpointRecord = {
  endpointId: string;
  provider: string;
  asn: number | null;
  poolCode: string;
  countryCode: string;
  region: string | null;
};

export function parseAuditTimestamp(entry: RouteReprobeJobAttemptAuditEntry) {
  const timestamp = Date.parse(entry.at);
  return Number.isNaN(timestamp) ? null : new Date(timestamp);
}

export function parseJobContext(job: RouteReprobeJob): TelemetryNetworkContext {
  if (!isRecord(job.context)) {
    return {
      networkType: undefined,
      carrier: undefined,
      asn: undefined,
      countryCode: undefined,
      region: undefined
    };
  }

  return {
    networkType:
      job.context.networkType === "wifi" || job.context.networkType === "mobile" || job.context.networkType === "unknown"
        ? job.context.networkType
        : undefined,
    carrier: typeof job.context.carrier === "string" ? job.context.carrier : undefined,
    asn: typeof job.context.asn === "number" ? job.context.asn : undefined,
    countryCode: typeof job.context.countryCode === "string" ? job.context.countryCode : undefined,
    region: typeof job.context.region === "string" ? job.context.region : undefined
  };
}

export function compareIsoDesc(left: string | null, right: string | null) {
  return Date.parse(right ?? "1970-01-01T00:00:00.000Z") - Date.parse(left ?? "1970-01-01T00:00:00.000Z");
}
