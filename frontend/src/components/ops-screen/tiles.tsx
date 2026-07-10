import type {
  AdminEndpointSummary,
  RouteDecisionOpsEventSummary,
  RouteDecisionOpsNetworkSummary,
  RouteDecisionOpsSummary,
} from "../../types";
import {
  formatAssignmentReason,
  formatFailureDomainLabel,
  formatFailureReason,
  formatFeedbackResult,
  formatFeedbackSource,
  formatNetworkSummary,
  formatRouteHealthStatus,
  formatRouteReprobeAttemptEvent,
  formatRouteReprobeJobStatus,
  formatSuccessRate,
} from "../../lib/formatters";
import { formatDateTime, formatMinutes } from "./formatters";

export function FleetEndpointTile({
  endpoint,
  isSubmitting,
  onRetire,
  onReactivate,
}: {
  endpoint: AdminEndpointSummary;
  isSubmitting: boolean;
  onRetire: (endpoint: AdminEndpointSummary) => Promise<void>;
  onReactivate: (endpoint: AdminEndpointSummary) => Promise<void>;
}) {
  return (
    <div className="serverButton">
      <span>
        {endpoint.isActive ? "active" : "retired"} · {endpoint.label}
      </span>
      <small>
        {endpoint.provider} · {endpoint.region ?? endpoint.city ?? endpoint.countryCode} · ASN {endpoint.asn ?? "—"}
      </small>
      <small>
        {endpoint.protocol} · {endpoint.transportProfile}
        {endpoint.transport ? ` · ${endpoint.transport.sni}` : ""}
      </small>
      <small>
        health-check {endpoint.lastHealthCheckOk === null ? "—" : endpoint.lastHealthCheckOk ? "ok" : "failing"} · consecutive
        failures {endpoint.consecutiveHealthFailures}
      </small>
      {!endpoint.isActive && endpoint.retiredReason ? (
        <small>
          {endpoint.retiredReason === "auto_health_failure"
            ? "auto-retired by health-check"
            : `retired: ${endpoint.retiredReason}`}
          {endpoint.retiredAt ? ` · ${new Date(endpoint.retiredAt).toLocaleString()}` : ""}
          {endpoint.retiredReason === "auto_health_failure" && endpoint.lastHealthCheckOk
            ? " · responding again, safe to reactivate"
            : ""}
        </small>
      ) : null}
      <div className="opsActionRow">
        {endpoint.isActive ? (
          <button className="ghostButton" disabled={isSubmitting} onClick={() => void onRetire(endpoint)}>
            Retire
          </button>
        ) : (
          <button className="ghostButton" disabled={isSubmitting} onClick={() => void onReactivate(endpoint)}>
            Reactivate
          </button>
        )}
      </div>
    </div>
  );
}

export function EndpointTile({
  endpoint: ep,
}: {
  endpoint: RouteDecisionOpsSummary["endpoints"][number];
}) {
  return (
    <div className="serverButton">
      <span>
        {ep.label} · {formatSuccessRate(ep.successRate)}
      </span>
      <small>
        {ep.provider} · {ep.region} · {ep.transportProfile}
      </small>
      <small>
        fail {ep.failedCount} · unstable {ep.unstableCount} · connected {ep.connectedCount}
      </small>
      <small>
        {formatFailureReason(ep.dominantFailureReason)} ·{" "}
        {new Date(ep.lastEventAt).toLocaleString("ru-RU")}
      </small>
    </div>
  );
}

export function NetworkTile({
  network: net,
}: {
  network: RouteDecisionOpsNetworkSummary;
}) {
  return (
    <div className="serverButton">
      <span>{formatNetworkSummary(net)}</span>
      <small>
        success {formatSuccessRate(net.successRate)} · fail {net.failedCount} · unstable{" "}
        {net.unstableCount}
      </small>
      <small>{new Date(net.lastEventAt).toLocaleString("ru-RU")}</small>
    </div>
  );
}

export function EventTile({
  event,
}: {
  event: RouteDecisionOpsEventSummary;
}) {
  return (
    <div className="serverButton">
      <span>
        {formatFeedbackResult(event.feedbackResult)} ·{" "}
        {event.endpointLabel ?? event.endpointId ?? "Unknown endpoint"}
      </span>
      <small>
        {formatFeedbackSource(event.source)} · {event.provider ?? "Unknown provider"} ·{" "}
        {event.transportProfile}
      </small>
      <small>
        {formatFailureReason(event.failureReason)} ·{" "}
        {formatNetworkSummary({
          networkFingerprintId: event.networkFingerprintId,
          networkType: event.networkType,
          carrier: event.carrier,
          asn: event.asn,
          countryCode: event.countryCode,
          region: event.region,
          feedbackEvents: 0,
          connectedCount: 0,
          unstableCount: 0,
          failedCount: 0,
          successRate: 0,
          lastEventAt: event.occurredAt,
        })}
      </small>
      <small>
        {new Date(event.occurredAt).toLocaleString("ru-RU")}
        {event.latencyMs !== null ? ` · ${event.latencyMs} ms` : ""}
        {event.appVersion ? ` · ${event.appVersion}` : ""}
      </small>
      {event.note ? <small>{event.note}</small> : null}
    </div>
  );
}

export function FailureDomainPressureTile({
  pressure,
}: {
  pressure: RouteDecisionOpsSummary["qualityMetrics"]["providerPressure"][number];
}) {
  return (
    <div className="serverButton">
      <span>{formatFailureDomainLabel(pressure)}</span>
      <small>
        fallback {pressure.fallbackCount} / {pressure.observationCount} · rate{" "}
        {formatSuccessRate(pressure.fallbackRate)}
      </small>
      <small>endpoints {pressure.affectedEndpoints}</small>
      <small>last trigger {formatDateTime(pressure.lastTriggeredAt)}</small>
    </div>
  );
}

export function FailureDomainRecoveryTile({
  domain,
}: {
  domain: RouteDecisionOpsSummary["qualityMetrics"]["recoveryByFailureDomain"][number];
}) {
  return (
    <div className="serverButton">
      <span>{formatFailureDomainLabel(domain)}</span>
      <small>
        active {domain.activeWindows} · resolved {domain.resolvedWindows}
      </small>
      <small>
        avg {formatMinutes(domain.averageRecoveryMinutes)} · median{" "}
        {formatMinutes(domain.medianRecoveryMinutes)}
      </small>
      <small>last recovered {formatDateTime(domain.lastRecoveredAt)}</small>
    </div>
  );
}

export function RouteReprobeJobTile({
  job,
}: {
  job: RouteDecisionOpsSummary["routeReprobeExecution"]["recentJobs"][number];
}) {
  const networkLabel = formatNetworkSummary({
    networkFingerprintId: null,
    networkType: job.context.networkType ?? null,
    carrier: job.context.carrier ?? null,
    asn: job.context.asn ?? null,
    countryCode: job.context.countryCode ?? null,
    region: job.context.region ?? null,
    feedbackEvents: 0,
    connectedCount: 0,
    unstableCount: 0,
    failedCount: 0,
    successRate: 0,
    lastEventAt: job.createdAt,
  });
  const recentAudit = job.attemptAudit.slice(-3).reverse();

  return (
    <div className="serverButton">
      <span>
        {formatRouteReprobeJobStatus(job.status)} · {job.id.slice(0, 8)}
      </span>
      <small>
        attempts {job.attempts}/{job.maxAttempts} · results {job.recordedResultsCount} · reclaims{" "}
        {job.leaseReclaimedCount}
      </small>
      <small>
        start {formatMinutes(job.timeToStartMinutes)} · lifecycle {formatMinutes(job.lifecycleMinutes)}
      </small>
      <small>
        {networkLabel}
      </small>
      <small>
        latest {formatRouteReprobeAttemptEvent(job.latestAttemptEvent)} · {formatDateTime(job.latestAttemptAt)}
      </small>
      <small>
        network feedback {job.qualityImpact.feedbackEventsOnJobNetwork} · connected{" "}
        {job.qualityImpact.connectedCountOnJobNetwork} · unstable{" "}
        {job.qualityImpact.unstableCountOnJobNetwork} · failed{" "}
        {job.qualityImpact.failedCountOnJobNetwork}
      </small>
      <small>
        fallback resolves {job.qualityImpact.fallbackResolvesOnJobNetwork} · degradation starts{" "}
        {job.qualityImpact.degradationStartsOnJobNetwork} · active degradation{" "}
        {job.qualityImpact.activeDegradationOnJobNetwork ? "yes" : "no"}
      </small>
      <small>
        dominant failure {formatFailureReason(job.qualityImpact.dominantFailureReasonOnJobNetwork)} · latest quality{" "}
        {formatDateTime(job.qualityImpact.latestQualityEventAt)}
      </small>
      {job.recommendedEndpointId ? (
        <small>recommended endpoint {job.recommendedEndpointId.slice(0, 8)}</small>
      ) : null}
      {job.candidates.length ? (
        job.candidates.slice(0, 3).map((candidate) => (
          <small key={`${job.id}-${candidate.endpointId}-${candidate.transportProfile}`}>
            candidate {candidate.endpointId.slice(0, 8)} · {candidate.provider} · {candidate.region} ·{" "}
            {formatAssignmentReason(candidate.assignmentReason)} ·{" "}
            {formatRouteHealthStatus(candidate.healthStatus)}
            {candidate.dominantFailureReason ? ` · ${formatFailureReason(candidate.dominantFailureReason)}` : ""}
          </small>
        ))
      ) : null}
      {job.failureMessage ? <small>{job.failureMessage}</small> : null}
      {job.note ? <small>{job.note}</small> : null}
      {recentAudit.map((entry) => (
        <small key={`${job.id}-${entry.at}-${entry.event}`}>
          {formatRouteReprobeAttemptEvent(entry.event)} · attempt {entry.attempt} · {formatDateTime(entry.at)}
          {entry.workerId ? ` · ${entry.workerId.slice(0, 8)}` : ""}
          {entry.nextAttemptAt ? ` · next ${formatDateTime(entry.nextAttemptAt)}` : ""}
        </small>
      ))}
    </div>
  );
}
