import type {
  TelemetryFailureReason,
  RouteHealthStatus,
  RoutePolicyTrace,
  RouteDecisionOpsEventSummary,
  RouteDecisionOpsNetworkSummary,
  RouteDecisionOpsFailureDomainRecovery,
  RouteDecisionOpsFailureDomainPressure,
  RouteDecisionOpsInventoryHealth,
  RouteReprobeJobAttemptAuditEntry,
  AccountSummary,
  AdminUserSummary,
} from "../types";

export function formatAssignmentReason(
  reason: string | null | undefined,
): string {
  switch (reason) {
    case "manual_select":
      return "Ручной выбор";
    case "manual_override":
      return "Ручной override";
    case "last_known_good":
      return "Последний рабочий маршрут";
    case "network_ranking_primary":
      return "Лучший по ranking";
    case "baseline_pool_priority":
      return "Базовый приоритет пула";
    case "route_health_adjusted_primary":
      return "Primary с health-adjustment";
    case "transport_diagnostic_fallback":
      return "Диагностический fallback";
    case "provider_diversity_fallback":
      return "Fallback по другому провайдеру";
    case "asn_diversity_fallback":
      return "Fallback по другому ASN";
    case "emergency_fallback":
      return "Аварийный fallback";
    default:
      return reason ?? "—";
  }
}

export function formatPolicySelector(
  selector: RoutePolicyTrace["selectedBy"] | undefined,
): string {
  switch (selector) {
    case "manual_override":
      return "Manual override";
    case "last_known_good":
      return "Last-known-good";
    case "network_ranking":
      return "Network ranking";
    case "baseline_pool_priority":
      return "Baseline priority";
    default:
      return "—";
  }
}

export function formatFailureReason(
  reason: TelemetryFailureReason | null | undefined,
): string {
  switch (reason) {
    case "timeout":
      return "Timeout";
    case "handshake_failed":
      return "Handshake failed";
    case "connect_refused":
      return "Connect refused";
    case "dns_blocked":
      return "DNS blocked";
    case "captive_portal":
      return "Captive portal";
    case "packet_loss_suspected":
      return "Packet loss";
    case "tls_error":
      return "TLS error";
    case "unknown":
      return "Unknown";
    default:
      return "—";
  }
}

export function formatRouteHealthStatus(
  status: RouteHealthStatus | "unknown" | undefined,
): string {
  switch (status) {
    case "healthy":
      return "Healthy";
    case "penalized":
      return "Penalized";
    case "avoid":
      return "Avoid";
    default:
      return "—";
  }
}

export function formatFeedbackResult(
  result: RouteDecisionOpsEventSummary["feedbackResult"] | undefined,
): string {
  switch (result) {
    case "connected":
      return "Connected";
    case "unstable":
      return "Unstable";
    case "failed":
      return "Failed";
    default:
      return "—";
  }
}

export function formatFeedbackSource(
  source: RouteDecisionOpsEventSummary["source"] | undefined,
): string {
  switch (source) {
    case "resolve":
      return "Resolve";
    case "connect":
      return "Connect";
    case "runtime_reprobe":
      return "Runtime reprobe";
    case "manual_report":
      return "Manual";
    default:
      return "—";
  }
}

export function formatRouteReprobeJobStatus(
  status: "queued" | "running" | "completed" | "failed" | "dead_letter" | undefined,
): string {
  switch (status) {
    case "queued":
      return "Queued";
    case "running":
      return "Running";
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
    case "dead_letter":
      return "Dead letter";
    default:
      return "—";
  }
}

export function formatRouteReprobeAttemptEvent(
  event: RouteReprobeJobAttemptAuditEntry["event"] | null | undefined,
): string {
  switch (event) {
    case "queued":
      return "Queued";
    case "claimed":
      return "Claimed";
    case "lease_reclaimed":
      return "Lease reclaimed";
    case "retry_scheduled":
      return "Retry scheduled";
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
    case "dead_lettered":
      return "Dead lettered";
    default:
      return "—";
  }
}

export function formatSuccessRate(
  value: number | null | undefined,
): string {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "—";
  }
  return `${Math.round(value * 100)}%`;
}

export function formatNetworkSummary(
  network: RouteDecisionOpsNetworkSummary,
): string {
  const parts = [
    network.networkType ?? null,
    network.carrier ?? null,
    network.asn !== null ? `ASN ${network.asn}` : null,
    network.countryCode ?? null,
    network.region ?? null,
  ].filter(Boolean);

  return parts.join(" · ") || "Unknown network";
}

export function formatFailureDomainLabel(
  domain:
    | RouteDecisionOpsFailureDomainPressure
    | RouteDecisionOpsFailureDomainRecovery,
): string {
  return `${domain.domainType === "provider" ? "Provider" : "ASN"} · ${domain.label}`;
}

export function formatInventoryFailedDimensions(
  health: RouteDecisionOpsInventoryHealth,
): string {
  if (!health.failedDimensions.length) {
    return "Policy satisfied";
  }

  return health.failedDimensions.join(" · ");
}

export function formatUserStatus(
  status:
    | AccountSummary["user"]["status"]
    | AdminUserSummary["status"]
    | undefined,
): string {
  switch (status) {
    case "active":
      return "Active";
    case "blocked":
      return "Blocked";
    case "trial":
      return "Trial";
    default:
      return "—";
  }
}

export function formatFallbackTier(
  tier: RoutePolicyTrace["fallbackTier"] | undefined,
): string {
  switch (tier) {
    case "manual":
      return "Manual";
    case "last_known_good":
      return "Last-known-good";
    case "ranking":
      return "Ranking";
    case "baseline":
      return "Baseline";
    default:
      return "—";
  }
}

export function formatDiversityStage(
  stage: RoutePolicyTrace["diversityStageReached"] | undefined,
): string {
  switch (stage) {
    case "strict":
      return "Strict";
    case "partial":
      return "Partial";
    case "same_domain_only":
      return "Same-domain only";
    default:
      return "—";
  }
}
