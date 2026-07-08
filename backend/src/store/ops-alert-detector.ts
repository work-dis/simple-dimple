import type { RouteDecisionOpsSummary } from "../types.js";

export type OpsAlertDetectorInput = {
  deadLetterJobs: number;
  staleRunningJobs: number;
  overdueQueuedJobs: number;
  executionImpactAttentionLevel: "stable" | "watch" | "critical";
  qualityEventsSinceLastSuccessfulCompletion: number;
  fallbackResolvesSinceLastSuccessfulCompletion: number;
  degradationStartsSinceLastSuccessfulCompletion: number;
  breachedSlaWindowCount: number;
  totalSlaWindowCount: number;
  slaAvailabilityTarget: number;
  inventoryRiskLevel: "ok" | "watch" | "critical";
  distinctInventoryProviders: number;
  distinctInventoryAsns: number;
  distinctInventoryRegions: number;
  activeInventoryEndpoints: number;
  largestRegionalDomainSize: number;
  minimumRecommendedFailureDomains: number;
  inventoryFailedDimensions: string[];
  inventoryPolicyViolationMessage: string | null;
};

export function detectOpsAlerts(input: OpsAlertDetectorInput): RouteDecisionOpsSummary["operationalSummary"]["alerts"] {
  const alerts: RouteDecisionOpsSummary["operationalSummary"]["alerts"] = [];

  if (input.deadLetterJobs > 0) {
    alerts.push({
      id: "dead-letter-jobs",
      severity: "critical",
      title: "Dead-letter jobs present",
      detail: `${input.deadLetterJobs} reprobe job(s) reached dead-letter and need triage.`
    });
  }

  if (input.staleRunningJobs > 0) {
    alerts.push({
      id: "stale-running-jobs",
      severity: "critical",
      title: "Stale running jobs detected",
      detail: `${input.staleRunningJobs} running job(s) exceeded lease window and may need reclaim attention.`
    });
  }

  if (input.overdueQueuedJobs > 0) {
    alerts.push({
      id: "overdue-queued-jobs",
      severity: "watch",
      title: "Queued jobs are overdue",
      detail: `${input.overdueQueuedJobs} queued job(s) are ready to run but still waiting for execution.`
    });
  }

  if (
    input.executionImpactAttentionLevel !== "stable" &&
    input.qualityEventsSinceLastSuccessfulCompletion > 0
  ) {
    alerts.push({
      id: "quality-signal-backlog",
      severity: input.executionImpactAttentionLevel === "critical" ? "critical" : "watch",
      title: "Route quality changed after last successful reprobe",
      detail:
        `${input.qualityEventsSinceLastSuccessfulCompletion} quality event(s), ` +
        `${input.fallbackResolvesSinceLastSuccessfulCompletion} fallback resolve(s) and ` +
        `${input.degradationStartsSinceLastSuccessfulCompletion} degradation start(s) accumulated after the last successful completion.`
    });
  }

  if (input.breachedSlaWindowCount > 0) {
    alerts.push({
      id: "sla-breaches",
      severity: input.breachedSlaWindowCount >= 2 ? "critical" : "watch",
      title: "SLA windows breached",
      detail: `${input.breachedSlaWindowCount} of ${input.totalSlaWindowCount} SLA window(s) fell below ${Math.round(input.slaAvailabilityTarget * 100)}% availability.`
    });
  }

  if (input.inventoryRiskLevel !== "ok") {
    alerts.push({
      id: "inventory-failure-domain-risk",
      severity: input.inventoryRiskLevel === "critical" ? "critical" : "watch",
      title: "Server inventory is not diverse enough",
      detail:
        input.inventoryPolicyViolationMessage ??
        (
          `${input.activeInventoryEndpoints} active endpoint(s), ` +
          `${input.distinctInventoryProviders} provider(s), ` +
          `${input.distinctInventoryAsns} ASN(s), ` +
          `${input.distinctInventoryRegions} regional domain(s); ` +
          `largest regional cluster holds ${input.largestRegionalDomainSize} endpoint(s) while target is ${input.minimumRecommendedFailureDomains} independent failure domains.`
        )
    });
  }

  return alerts;
}

export function detectOpsAlertsFromSummary(summary: RouteDecisionOpsSummary) {
  return detectOpsAlerts({
    deadLetterJobs: summary.routeReprobeExecution.totals.deadLetterJobs,
    staleRunningJobs: summary.routeReprobeExecution.totals.staleRunningJobs,
    overdueQueuedJobs: summary.routeReprobeExecution.totals.overdueQueuedJobs,
    executionImpactAttentionLevel: summary.qualityMetrics.executionImpact.attentionLevel,
    qualityEventsSinceLastSuccessfulCompletion:
      summary.qualityMetrics.executionImpact.qualityEventsSinceLastSuccessfulCompletion,
    fallbackResolvesSinceLastSuccessfulCompletion:
      summary.qualityMetrics.executionImpact.fallbackResolvesSinceLastSuccessfulCompletion,
    degradationStartsSinceLastSuccessfulCompletion:
      summary.qualityMetrics.executionImpact.degradationStartsSinceLastSuccessfulCompletion,
    breachedSlaWindowCount: summary.qualityMetrics.slaWindows.breached,
    totalSlaWindowCount: summary.qualityMetrics.slaWindows.total,
    slaAvailabilityTarget: summary.qualityMetrics.slaWindows.availabilityTarget,
    inventoryRiskLevel: summary.operationalSummary.inventoryHealth.riskLevel,
    distinctInventoryProviders: summary.operationalSummary.inventoryHealth.distinctProviders,
    distinctInventoryAsns: summary.operationalSummary.inventoryHealth.distinctAsns,
    distinctInventoryRegions: summary.operationalSummary.inventoryHealth.distinctRegions,
    activeInventoryEndpoints: summary.operationalSummary.inventoryHealth.activeEndpoints,
    largestRegionalDomainSize: summary.operationalSummary.inventoryHealth.largestRegionalDomainSize,
    minimumRecommendedFailureDomains: summary.operationalSummary.inventoryHealth.minimumRecommendedFailureDomains,
    inventoryFailedDimensions: summary.operationalSummary.inventoryHealth.failedDimensions,
    inventoryPolicyViolationMessage: summary.operationalSummary.inventoryHealth.policyViolationMessage
  });
}

export function computeOpsOverallSeverity(
  alerts: RouteDecisionOpsSummary["operationalSummary"]["alerts"]
): RouteDecisionOpsSummary["operationalSummary"]["overallSeverity"] {
  return alerts.some((alert) => alert.severity === "critical")
    ? "critical"
    : alerts.length > 0
      ? "watch"
      : "ok";
}
