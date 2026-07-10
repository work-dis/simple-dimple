import type { RouteDecisionOpsSummary } from "../../types";
import { formatAssignmentReason, formatSuccessRate } from "../../lib/formatters";
import { FailureDomainPressureTile, FailureDomainRecoveryTile } from "./tiles";
import { formatDateTime, formatExecutionImpactAttention, formatMinutes } from "./formatters";

export function QualityMetricsSection({
  qualityMetrics,
}: {
  qualityMetrics: RouteDecisionOpsSummary["qualityMetrics"];
}) {
  return (
    <div className="opsSection">
      <h2>Explainable quality metrics</h2>
      <div className="serverList">
        <div className="serverButton">
          <span>Execution impact</span>
          <small>
            attention {formatExecutionImpactAttention(qualityMetrics.executionImpact.attentionLevel)} · active degraded
            networks {qualityMetrics.executionImpact.activeDegradedNetworks}
          </small>
          <small>
            impacted queued/running {qualityMetrics.executionImpact.queuedOrRunningJobsOnActiveDegradedNetworks} ·
            dead letter {qualityMetrics.executionImpact.deadLetterJobsOnActiveDegradedNetworks}
          </small>
          <small>
            since last success {qualityMetrics.executionImpact.qualityEventsSinceLastSuccessfulCompletion} feedback ·{" "}
            {qualityMetrics.executionImpact.fallbackResolvesSinceLastSuccessfulCompletion} fallback resolve ·{" "}
            {qualityMetrics.executionImpact.degradationStartsSinceLastSuccessfulCompletion} degradation starts
          </small>
          <small>
            last successful completion {formatDateTime(qualityMetrics.executionImpact.lastSuccessfulCompletionAt)} ·{" "}
            age {formatMinutes(qualityMetrics.executionImpact.minutesSinceLastSuccessfulCompletion)}
          </small>
        </div>
        <div className="serverButton">
          <span>Fallback pressure</span>
          <small>
            {qualityMetrics.fallbackPressure.fallbackCount} / {qualityMetrics.fallbackPressure.observationCount}{" "}
            runtime reprobe snapshots ушли в fallback
          </small>
          <small>
            rate {formatSuccessRate(qualityMetrics.fallbackPressure.fallbackRate)} · причина{" "}
            {formatAssignmentReason(qualityMetrics.fallbackPressure.dominantFallbackReason)}
          </small>
          <small>
            last trigger {formatDateTime(qualityMetrics.fallbackPressure.lastTriggeredAt)}
          </small>
        </div>
        <div className="serverButton">
          <span>Degradation windows</span>
          <small>
            active {qualityMetrics.degradationWindows.active} · resolved{" "}
            {qualityMetrics.degradationWindows.resolved} · total{" "}
            {qualityMetrics.degradationWindows.total}
          </small>
          <small>
            endpoints {qualityMetrics.degradationWindows.affectedEndpoints} · networks{" "}
            {qualityMetrics.degradationWindows.affectedNetworks}
          </small>
          <small>
            longest active {formatMinutes(qualityMetrics.degradationWindows.longestActiveMinutes)} · last start{" "}
            {formatDateTime(qualityMetrics.degradationWindows.lastStartedAt)}
          </small>
        </div>
        <div className="serverButton">
          <span>Recovery time</span>
          <small>
            avg {formatMinutes(qualityMetrics.recoveryTime.averageMinutes)} · median{" "}
            {formatMinutes(qualityMetrics.recoveryTime.medianMinutes)}
          </small>
          <small>
            resolved windows {qualityMetrics.recoveryTime.resolvedWindowCount}
          </small>
          <small>
            last recovered {formatDateTime(qualityMetrics.recoveryTime.lastRecoveredAt)}
          </small>
        </div>
        <div className="serverButton">
          <span>SLA windows</span>
          <small>
            healthy {qualityMetrics.slaWindows.healthy} · breached{" "}
            {qualityMetrics.slaWindows.breached} · total{" "}
            {qualityMetrics.slaWindows.total}
          </small>
          <small>
            target {formatSuccessRate(qualityMetrics.slaWindows.availabilityTarget)} · breach rate{" "}
            {formatSuccessRate(qualityMetrics.slaWindows.breachRate)}
          </small>
          <small>
            streak {qualityMetrics.slaWindows.currentHealthyStreak} windows · last breach{" "}
            {formatDateTime(qualityMetrics.slaWindows.lastBreachAt)}
          </small>
        </div>
      </div>
    </div>
  );
}

export function PressureSection({
  providerPressure,
  asnPressure,
}: {
  providerPressure: RouteDecisionOpsSummary["qualityMetrics"]["providerPressure"];
  asnPressure: RouteDecisionOpsSummary["qualityMetrics"]["asnPressure"];
}) {
  return (
    <div className="opsSection">
      <h2>Provider / ASN pressure</h2>
      <div className="serverList">
        {providerPressure.map((pressure) => (
          <FailureDomainPressureTile
            key={`${pressure.domainType}:${pressure.domainKey}`}
            pressure={pressure}
          />
        ))}
        {asnPressure.map((pressure) => (
          <FailureDomainPressureTile
            key={`${pressure.domainType}:${pressure.domainKey}`}
            pressure={pressure}
          />
        ))}
        {!providerPressure.length && !asnPressure.length ? (
          <div className="serverButton">
            <span>Пока нет pressure-сигналов по failure domains.</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function RecoverySection({
  recoveryByFailureDomain,
}: {
  recoveryByFailureDomain: RouteDecisionOpsSummary["qualityMetrics"]["recoveryByFailureDomain"];
}) {
  return (
    <div className="opsSection">
      <h2>Recovery by failure domain</h2>
      <div className="serverList">
        {recoveryByFailureDomain.length ? (
          recoveryByFailureDomain.map((domain) => (
            <FailureDomainRecoveryTile
              key={`${domain.domainType}:${domain.domainKey}`}
              domain={domain}
            />
          ))
        ) : (
          <div className="serverButton">
            <span>Пока нет recovery-сигналов по failure domains.</span>
          </div>
        )}
      </div>
    </div>
  );
}
