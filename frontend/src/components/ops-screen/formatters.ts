import type { OpsAlertSummary, RouteDecisionOpsSummary } from "../../types";

export function formatDateTime(value: string | null) {
  return value ? new Date(value).toLocaleString("ru-RU") : "—";
}

export function formatMinutes(value: number | null) {
  return typeof value === "number" ? `${value.toFixed(1)} min` : "—";
}

export function formatExecutionImpactAttention(value: RouteDecisionOpsSummary["qualityMetrics"]["executionImpact"]["attentionLevel"]) {
  return value === "critical" ? "critical" : value === "watch" ? "watch" : "stable";
}

export function formatOperationalSeverity(value: RouteDecisionOpsSummary["operationalSummary"]["overallSeverity"]) {
  return value === "critical" ? "critical" : value === "watch" ? "watch" : "ok";
}

export function formatAlertSeverity(value: RouteDecisionOpsSummary["operationalSummary"]["alerts"][number]["severity"]) {
  return value === "critical" ? "critical" : "watch";
}

export function formatInventoryRisk(value: RouteDecisionOpsSummary["operationalSummary"]["inventoryHealth"]["riskLevel"]) {
  return value === "critical" ? "critical" : value === "watch" ? "watch" : "ok";
}

export function formatPersistedAlertStatus(value: OpsAlertSummary["status"]) {
  switch (value) {
    case "active":
      return "active";
    case "acknowledged":
      return "acknowledged";
    case "snoozed":
      return "snoozed";
    case "resolved":
      return "resolved";
    default:
      return value;
  }
}

export function formatFailureKey(value: string) {
  return value === "lease_expired_before_completion" ? "Lease expired before completion" : value;
}

export function formatHistoryEnd(value: string) {
  return new Date(value).toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDay(value: string) {
  return new Date(value).toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export function shortWorkerId(value: string) {
  return value.length > 8 ? value.slice(0, 8) : value;
}

export function readInventoryAlertMetadata(metadata: Record<string, unknown>) {
  if (!metadata || typeof metadata !== "object") {
    return null;
  }

  const source = typeof metadata.source === "string" ? metadata.source : null;
  if (source !== "route_decision_ops_summary") {
    return null;
  }

  const inventoryFailedDimensions = Array.isArray(metadata.inventoryFailedDimensions)
    ? metadata.inventoryFailedDimensions.filter((value): value is string => typeof value === "string")
    : [];
  const inventoryPolicyViolationMessage =
    typeof metadata.inventoryPolicyViolationMessage === "string" ? metadata.inventoryPolicyViolationMessage : null;
  const activeInventoryEndpoints =
    typeof metadata.activeInventoryEndpoints === "number" ? metadata.activeInventoryEndpoints : null;
  const distinctInventoryProviders =
    typeof metadata.distinctInventoryProviders === "number" ? metadata.distinctInventoryProviders : null;
  const distinctInventoryAsns =
    typeof metadata.distinctInventoryAsns === "number" ? metadata.distinctInventoryAsns : null;
  const distinctInventoryRegions =
    typeof metadata.distinctInventoryRegions === "number" ? metadata.distinctInventoryRegions : null;
  const minimumRecommendedFailureDomains =
    typeof metadata.minimumRecommendedFailureDomains === "number" ? metadata.minimumRecommendedFailureDomains : null;

  if (
    inventoryFailedDimensions.length === 0 &&
    inventoryPolicyViolationMessage === null &&
    activeInventoryEndpoints === null &&
    distinctInventoryProviders === null &&
    distinctInventoryAsns === null &&
    distinctInventoryRegions === null &&
    minimumRecommendedFailureDomains === null
  ) {
    return null;
  }

  return {
    inventoryFailedDimensions,
    inventoryPolicyViolationMessage,
    activeInventoryEndpoints,
    distinctInventoryProviders,
    distinctInventoryAsns,
    distinctInventoryRegions,
    minimumRecommendedFailureDomains
  };
}
