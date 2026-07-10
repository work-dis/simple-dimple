import type { OpsAlertSummary } from "../types.js";

// --------------------------------------------------------------------------
// Message/body builders for ops-alert escalation and digest delivery
// --------------------------------------------------------------------------

function readInventoryAlertMetadata(metadata: Record<string, unknown>) {
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

function buildOpsAlertInventoryContext(metadata: Record<string, unknown>) {
  const inventoryAlertMetadata = readInventoryAlertMetadata(metadata);

  if (!inventoryAlertMetadata) {
    return null;
  }

  return [
    inventoryAlertMetadata.inventoryPolicyViolationMessage,
    inventoryAlertMetadata.inventoryFailedDimensions.length > 0
      ? `Failed dimensions: ${inventoryAlertMetadata.inventoryFailedDimensions.join(", ")}`
      : null,
    inventoryAlertMetadata.activeInventoryEndpoints !== null ||
    inventoryAlertMetadata.distinctInventoryProviders !== null ||
    inventoryAlertMetadata.distinctInventoryAsns !== null ||
    inventoryAlertMetadata.distinctInventoryRegions !== null
      ? `Inventory counts: endpoints ${inventoryAlertMetadata.activeInventoryEndpoints ?? "—"}, providers ${inventoryAlertMetadata.distinctInventoryProviders ?? "—"}, ASNs ${inventoryAlertMetadata.distinctInventoryAsns ?? "—"}, regions ${inventoryAlertMetadata.distinctInventoryRegions ?? "—"}`
      : null,
    inventoryAlertMetadata.minimumRecommendedFailureDomains !== null
      ? `Policy target: ${inventoryAlertMetadata.minimumRecommendedFailureDomains} independent failure domains`
      : null
  ]
    .filter((value): value is string => Boolean(value))
    .join("\n");
}

export function buildAlertMessageBody(alert: Pick<OpsAlertSummary, "detail" | "metadata" | "status" | "severity" | "lastDetectedAt">) {
  const inventoryContext = buildOpsAlertInventoryContext(alert.metadata);

  return (
    `${alert.detail.trim()}\n\n` +
    `${inventoryContext ? `${inventoryContext}\n\n` : ""}` +
    `Status: ${alert.status}\n` +
    `Severity: ${alert.severity}\n` +
    `Last detected: ${alert.lastDetectedAt}`
  );
}

export function buildDigestSubject(alertCount: number) {
  return `[digest/watch] ${alertCount} ops alerts need follow-up`;
}

export function buildDigestMessage(alerts: OpsAlertSummary[]) {
  return [
    "Watch-level ops digest",
    "",
    `Included alerts: ${alerts.length}`,
    ...alerts.flatMap((alert, index) => ["", `${index + 1}. ${alert.title}`, buildAlertMessageBody(alert)])
  ].join("\n");
}
