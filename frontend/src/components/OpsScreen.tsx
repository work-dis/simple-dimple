import type {
  AuthSession,
  AccountSummary,
  OpsAlertDeliverySummary,
  OpsAlertEscalationPreview,
  OpsAlertSummary,
  RouteDecisionOpsSummary,
  RouteDecisionOpsEventSummary,
  RouteDecisionOpsNetworkSummary,
} from "../types";
import {
  formatAssignmentReason,
  formatFailureDomainLabel,
  formatFailureReason,
  formatFeedbackResult,
  formatFeedbackSource,
  formatInventoryFailedDimensions,
  formatRouteHealthStatus,
  formatRouteReprobeAttemptEvent,
  formatRouteReprobeJobStatus,
  formatSuccessRate,
  formatNetworkSummary,
} from "../lib/formatters";

interface Props {
  auth: AuthSession | null;
  account: AccountSummary | null;
  routeDecisionOps: RouteDecisionOpsSummary | null;
  opsAlerts: OpsAlertSummary[];
  opsAlertEscalationPreviews: Record<string, OpsAlertEscalationPreview>;
  opsAlertDeliveries: Record<string, OpsAlertDeliverySummary[]>;
  isSubmitting: boolean;
  onReload: () => void;
  onAcknowledgeAlert: (alertId: string) => Promise<void>;
  onSnoozeAlert: (alertId: string, minutes?: number) => Promise<void>;
  onUnacknowledgeAlert: (alertId: string) => Promise<void>;
  onLoadEscalationPreview: (alertId: string) => Promise<void>;
  onLoadAlertDeliveries: (alertId: string) => Promise<void>;
  onDeliverAlert: (alertId: string) => Promise<void>;
  onRetryAlertDelivery: (alertId: string, deliveryId: string) => Promise<void>;
  onResendAlertDelivery: (alertId: string, deliveryId: string) => Promise<void>;
  onDeliverAlertDigest: () => Promise<void>;
}

export function OpsScreen({
  auth,
  account,
  routeDecisionOps,
  opsAlerts,
  opsAlertEscalationPreviews,
  opsAlertDeliveries,
  isSubmitting,
  onReload,
  onAcknowledgeAlert,
  onSnoozeAlert,
  onUnacknowledgeAlert,
  onLoadEscalationPreview,
  onLoadAlertDeliveries,
  onDeliverAlert,
  onRetryAlertDelivery,
  onResendAlertDelivery,
  onDeliverAlertDigest,
}: Props) {
  const canView = auth?.isAuthenticated && account?.user.isAdmin;

  return (
    <>
      <h1>Route Ops</h1>
      <p className="hint">
        Сводка по feedback, persisted reprobe trail и explainable quality metrics без ручных запросов в базу.
      </p>

      {canView && routeDecisionOps ? (
        <OpsDashboard
          ops={routeDecisionOps}
          opsAlerts={opsAlerts}
          opsAlertEscalationPreviews={opsAlertEscalationPreviews}
          opsAlertDeliveries={opsAlertDeliveries}
          isSubmitting={isSubmitting}
          onReload={onReload}
          onAcknowledgeAlert={onAcknowledgeAlert}
          onSnoozeAlert={onSnoozeAlert}
          onUnacknowledgeAlert={onUnacknowledgeAlert}
          onLoadEscalationPreview={onLoadEscalationPreview}
          onLoadAlertDeliveries={onLoadAlertDeliveries}
          onDeliverAlert={onDeliverAlert}
          onRetryAlertDelivery={onRetryAlertDelivery}
          onResendAlertDelivery={onResendAlertDelivery}
          onDeliverAlertDigest={onDeliverAlertDigest}
        />
      ) : (
        <div className="signedOutCard">
          <strong>
            {!auth?.isAuthenticated
              ? "Нужно войти, чтобы открыть ops-наблюдение."
              : !account?.user.isAdmin
                ? "Этот раздел доступен только администратору."
                : "Загружаем ops-сводку..."}
          </strong>
        </div>
      )}
    </>
  );
}

/* ──────────────── Dashboard ──────────────── */

interface OpsDashboardProps {
  ops: RouteDecisionOpsSummary;
  opsAlerts: OpsAlertSummary[];
  opsAlertEscalationPreviews: Record<string, OpsAlertEscalationPreview>;
  opsAlertDeliveries: Record<string, OpsAlertDeliverySummary[]>;
  isSubmitting: boolean;
  onReload: () => void;
  onAcknowledgeAlert: (alertId: string) => Promise<void>;
  onSnoozeAlert: (alertId: string, minutes?: number) => Promise<void>;
  onUnacknowledgeAlert: (alertId: string) => Promise<void>;
  onLoadEscalationPreview: (alertId: string) => Promise<void>;
  onLoadAlertDeliveries: (alertId: string) => Promise<void>;
  onDeliverAlert: (alertId: string) => Promise<void>;
  onRetryAlertDelivery: (alertId: string, deliveryId: string) => Promise<void>;
  onResendAlertDelivery: (alertId: string, deliveryId: string) => Promise<void>;
  onDeliverAlertDigest: () => Promise<void>;
}

function OpsDashboard({
  ops,
  opsAlerts,
  opsAlertEscalationPreviews,
  opsAlertDeliveries,
  isSubmitting,
  onReload,
  onAcknowledgeAlert,
  onSnoozeAlert,
  onUnacknowledgeAlert,
  onLoadEscalationPreview,
  onLoadAlertDeliveries,
  onDeliverAlert,
  onRetryAlertDelivery,
  onResendAlertDelivery,
  onDeliverAlertDigest,
}: OpsDashboardProps) {
  const watchAlerts = opsAlerts.filter((alert) => alert.severity === "watch");

  return (
    <>
      <div className="details">
        <div>
          <span>Окно наблюдения</span>
          <strong>{ops.windowHours} часов</strong>
        </div>
        <div>
          <span>Всего feedback</span>
          <strong>{ops.totals.feedbackEvents}</strong>
        </div>
        <div>
          <span>Success rate</span>
          <strong>{formatSuccessRate(ops.totals.successRate)}</strong>
        </div>
        <div>
          <span>Connected / unstable / failed</span>
          <strong>
            {ops.totals.connectedCount} / {ops.totals.unstableCount} / {ops.totals.failedCount}
          </strong>
        </div>
        <div>
          <span>Уникальные endpoint-ы</span>
          <strong>{ops.totals.uniqueEndpoints}</strong>
        </div>
        <div>
          <span>Уникальные сети</span>
          <strong>{ops.totals.uniqueNetworks}</strong>
        </div>
        <div>
          <span>Срез собран</span>
          <strong>{new Date(ops.generatedAt).toLocaleString("ru-RU")}</strong>
        </div>
      </div>

      <div className="opsSection">
        <div className="opsHeaderRow">
          <h2>Persisted alerts feed</h2>
          <div className="opsActionRow">
            {watchAlerts.length ? (
              <button className="ghostButton" onClick={() => void onDeliverAlertDigest()} disabled={isSubmitting}>
                Send watch digest
              </button>
            ) : null}
            <button className="ghostButton" onClick={onReload} disabled={isSubmitting}>
              Refresh feed
            </button>
          </div>
        </div>
        {watchAlerts.length ? (
          <p className="hint">
            Watch-level alerts go through one shared digest batch for the current feed, not per-alert delivery.
          </p>
        ) : null}
        <div className="serverList">
          {opsAlerts.length ? (
            opsAlerts.map((alert) => (
              <PersistedAlertTile
                key={alert.id}
                alert={alert}
                escalationPreview={opsAlertEscalationPreviews[alert.id] ?? null}
                deliveries={opsAlertDeliveries[alert.id] ?? []}
                isSubmitting={isSubmitting}
                onAcknowledgeAlert={onAcknowledgeAlert}
                onSnoozeAlert={onSnoozeAlert}
                onUnacknowledgeAlert={onUnacknowledgeAlert}
                onLoadEscalationPreview={onLoadEscalationPreview}
                onLoadAlertDeliveries={onLoadAlertDeliveries}
                onDeliverAlert={onDeliverAlert}
                onRetryAlertDelivery={onRetryAlertDelivery}
                onResendAlertDelivery={onResendAlertDelivery}
              />
            ))
          ) : (
            <div className="serverButton">
              <span>No persisted alerts yet.</span>
              <small>The current ops summary does not materialize active feed items in this observation window.</small>
            </div>
          )}
        </div>
      </div>

      <div className="opsSection">
        <h2>Attention now</h2>
        <div className="serverList">
          <div className="serverButton">
            <span>Overall severity</span>
            <small>
              {formatOperationalSeverity(ops.operationalSummary.overallSeverity)} · active alerts{" "}
              {ops.operationalSummary.activeAlertCount}
            </small>
            <small>
              inventory {formatInventoryRisk(ops.operationalSummary.inventoryHealth.riskLevel)} · endpoints{" "}
              {ops.operationalSummary.inventoryHealth.activeEndpoints} · providers{" "}
              {ops.operationalSummary.inventoryHealth.distinctProviders} · ASN{" "}
              {ops.operationalSummary.inventoryHealth.distinctAsns}
            </small>
            <small>
              pools {ops.operationalSummary.inventoryHealth.distinctPools} · regional domains{" "}
              {ops.operationalSummary.inventoryHealth.distinctRegions} · biggest cluster{" "}
              {ops.operationalSummary.inventoryHealth.largestRegionalDomainSize}
            </small>
            <small>
              policy target {ops.operationalSummary.inventoryHealth.minimumRecommendedFailureDomains} domains ·{" "}
              {formatInventoryFailedDimensions(ops.operationalSummary.inventoryHealth)}
            </small>
            {ops.operationalSummary.inventoryHealth.policyViolationMessage ? (
              <small>{ops.operationalSummary.inventoryHealth.policyViolationMessage}</small>
            ) : null}
            <small>
              retention jobs {ops.operationalSummary.retention.routeReprobeJobsDays}d · events{" "}
              {ops.operationalSummary.retention.routeEventsDays}d · probes{" "}
              {ops.operationalSummary.retention.probeReportsDays}d
            </small>
            <small>
              rollups {ops.operationalSummary.retention.routeSuccessRollupsDays}d · rankings{" "}
              {ops.operationalSummary.retention.routeRankingsDays}d
            </small>
          </div>
          {ops.operationalSummary.alerts.length ? (
            ops.operationalSummary.alerts.map((alert) => (
              <div className="serverButton" key={alert.id}>
                <span>
                  {formatAlertSeverity(alert.severity)} · {alert.title}
                </span>
                <small>{alert.detail}</small>
              </div>
            ))
          ) : (
            <div className="serverButton">
              <span>No active ops alerts.</span>
              <small>Worker execution and route-quality summary look healthy in the current observation window.</small>
            </div>
          )}
        </div>
      </div>

      <div className="opsSection">
        <h2>Recent ops history</h2>
        <div className="serverList">
          {ops.operationalSummary.history.length ? (
            ops.operationalSummary.history.map((window) => (
              <div className="serverButton" key={window.startedAt}>
                <span>
                  {formatOperationalSeverity(window.severity)} · {formatDateTime(window.startedAt)} -{" "}
                  {formatHistoryEnd(window.endedAt)}
                </span>
                <small>
                  feedback {window.feedbackEvents} · connected {window.connectedCount} · unstable{" "}
                  {window.unstableCount} · failed {window.failedCount}
                </small>
                <small>
                  fallback resolves {window.fallbackResolves} · queued jobs {window.queuedJobs}
                </small>
                <small>
                  completed jobs {window.completedJobs} · dead letter {window.deadLetterJobs}
                </small>
              </div>
            ))
          ) : (
            <div className="serverButton">
              <span>No history windows yet.</span>
            </div>
          )}
        </div>
      </div>

      <div className="opsSection">
        <h2>Daily ops history</h2>
        <div className="serverList">
          {ops.operationalSummary.dailyHistory.length ? (
            ops.operationalSummary.dailyHistory.map((window) => (
              <div className="serverButton" key={window.startedAt}>
                <span>
                  {formatOperationalSeverity(window.severity)} · {formatDay(window.startedAt)}
                </span>
                <small>
                  hourly windows {window.hourlyWindows} · feedback {window.feedbackEvents} · connected{" "}
                  {window.connectedCount}
                </small>
                <small>
                  unstable {window.unstableCount} · failed {window.failedCount} · fallback resolves{" "}
                  {window.fallbackResolves}
                </small>
                <small>
                  queued jobs {window.queuedJobs} · completed {window.completedJobs} · dead letter{" "}
                  {window.deadLetterJobs}
                </small>
              </div>
            ))
          ) : (
            <div className="serverButton">
              <span>No daily history yet.</span>
            </div>
          )}
        </div>
      </div>

      <div className="opsSection">
        <h2>Focused triage drilldown</h2>
        <div className="serverList">
          {ops.routeReprobeExecution.focusedDrilldowns.worker ? (
            <div className="serverButton">
              <span>
                Worker focus · {shortWorkerId(ops.routeReprobeExecution.focusedDrilldowns.worker.workerId)}
              </span>
              <small>
                alerts {ops.routeReprobeExecution.focusedDrilldowns.worker.activeAlertCount} · active jobs{" "}
                {ops.routeReprobeExecution.focusedDrilldowns.worker.activeJobs} · dead letter{" "}
                {ops.routeReprobeExecution.focusedDrilldowns.worker.deadLetterJobs}
              </small>
              <small>
                retries {ops.routeReprobeExecution.focusedDrilldowns.worker.retryScheduledCount} · failed events{" "}
                {ops.routeReprobeExecution.focusedDrilldowns.worker.failedEventCount} · lease reclaims{" "}
                {ops.routeReprobeExecution.focusedDrilldowns.worker.leaseReclaimedCount}
              </small>
              <small>
                stale running {ops.routeReprobeExecution.focusedDrilldowns.worker.staleRunningJobs} · latest activity{" "}
                {formatDateTime(ops.routeReprobeExecution.focusedDrilldowns.worker.latestActivityAt)}
              </small>
              <small>
                jobs {ops.routeReprobeExecution.focusedDrilldowns.worker.sampleJobIds.map((jobId) => jobId.slice(0, 8)).join(", ") || "—"}
              </small>
              {ops.routeReprobeExecution.focusedDrilldowns.worker.relatedFailures.map((failure) => (
                <small key={`focus-worker-failure-${failure.failureKey}`}>
                  failure {formatFailureKey(failure.failureKey)} · jobs {failure.affectedJobs} · dead letter{" "}
                  {failure.deadLetterJobs}
                </small>
              ))}
              {ops.routeReprobeExecution.focusedDrilldowns.worker.recentTimeline.map((entry) => (
                <small key={`focus-worker-timeline-${entry.jobId}-${entry.at}-${entry.event}`}>
                  {formatRouteReprobeAttemptEvent(entry.event)} · {entry.jobId.slice(0, 8)} · attempt {entry.attempt} ·{" "}
                  {formatDateTime(entry.at)}
                </small>
              ))}
            </div>
          ) : null}
          {ops.routeReprobeExecution.focusedDrilldowns.network ? (
            <div className="serverButton">
              <span>
                Network focus · {formatNetworkSummary({
                  networkFingerprintId: null,
                  networkType: ops.routeReprobeExecution.focusedDrilldowns.network.network.networkType ?? null,
                  carrier: ops.routeReprobeExecution.focusedDrilldowns.network.network.carrier ?? null,
                  asn: ops.routeReprobeExecution.focusedDrilldowns.network.network.asn ?? null,
                  countryCode: ops.routeReprobeExecution.focusedDrilldowns.network.network.countryCode ?? null,
                  region: ops.routeReprobeExecution.focusedDrilldowns.network.network.region ?? null,
                  feedbackEvents: ops.routeReprobeExecution.focusedDrilldowns.network.feedbackEvents,
                  connectedCount: ops.routeReprobeExecution.focusedDrilldowns.network.connectedCount,
                  unstableCount: ops.routeReprobeExecution.focusedDrilldowns.network.unstableCount,
                  failedCount: ops.routeReprobeExecution.focusedDrilldowns.network.failedCount,
                  successRate:
                    ops.routeReprobeExecution.focusedDrilldowns.network.feedbackEvents > 0
                      ? ops.routeReprobeExecution.focusedDrilldowns.network.connectedCount /
                        ops.routeReprobeExecution.focusedDrilldowns.network.feedbackEvents
                      : 0,
                  lastEventAt:
                    ops.routeReprobeExecution.focusedDrilldowns.network.latestQualityEventAt ??
                    ops.routeReprobeExecution.focusedDrilldowns.network.latestJobAt ??
                    ops.generatedAt,
                })}
              </span>
              <small>
                queued/running {ops.routeReprobeExecution.focusedDrilldowns.network.queuedOrRunningJobs} · dead letter{" "}
                {ops.routeReprobeExecution.focusedDrilldowns.network.deadLetterJobs}
              </small>
              <small>
                feedback {ops.routeReprobeExecution.focusedDrilldowns.network.feedbackEvents} · failed{" "}
                {ops.routeReprobeExecution.focusedDrilldowns.network.failedCount} · fallback resolves{" "}
                {ops.routeReprobeExecution.focusedDrilldowns.network.fallbackResolves}
              </small>
              <small>
                active degradation {ops.routeReprobeExecution.focusedDrilldowns.network.activeDegradation ? "yes" : "no"} · duration{" "}
                {formatMinutes(ops.routeReprobeExecution.focusedDrilldowns.network.activeDegradationMinutes)} · dominant failure{" "}
                {formatFailureReason(ops.routeReprobeExecution.focusedDrilldowns.network.dominantFailureReason)}
              </small>
              <small>
                latest job {formatDateTime(ops.routeReprobeExecution.focusedDrilldowns.network.latestJobAt)} · latest quality{" "}
                {formatDateTime(ops.routeReprobeExecution.focusedDrilldowns.network.latestQualityEventAt)}
              </small>
              {ops.routeReprobeExecution.focusedDrilldowns.network.relatedJobs.map((job) => (
                <small key={`focus-network-job-${job.id}`}>
                  job {job.id.slice(0, 8)} · {formatRouteReprobeJobStatus(job.status)} · latest{" "}
                  {formatRouteReprobeAttemptEvent(job.latestAttemptEvent)} · {formatDateTime(job.latestAttemptAt)}
                </small>
              ))}
            </div>
          ) : null}
          {ops.routeReprobeExecution.focusedDrilldowns.job ? (
            <div className="serverButton">
              <span>
                Job focus · {ops.routeReprobeExecution.focusedDrilldowns.job.job.id.slice(0, 8)} ·{" "}
                {formatRouteReprobeJobStatus(ops.routeReprobeExecution.focusedDrilldowns.job.job.status)}
              </span>
              <small>
                attempts {ops.routeReprobeExecution.focusedDrilldowns.job.job.attempts}/
                {ops.routeReprobeExecution.focusedDrilldowns.job.job.maxAttempts} · lifecycle{" "}
                {formatMinutes(ops.routeReprobeExecution.focusedDrilldowns.job.job.lifecycleMinutes)}
              </small>
              <small>
                workers {ops.routeReprobeExecution.focusedDrilldowns.job.relatedWorkerIds.map(shortWorkerId).join(", ") || "—"} ·
                latest {formatRouteReprobeAttemptEvent(ops.routeReprobeExecution.focusedDrilldowns.job.job.latestAttemptEvent)} ·{" "}
                {formatDateTime(ops.routeReprobeExecution.focusedDrilldowns.job.job.latestAttemptAt)}
              </small>
              <small>
                network feedback {ops.routeReprobeExecution.focusedDrilldowns.job.job.qualityImpact.feedbackEventsOnJobNetwork} ·
                failed {ops.routeReprobeExecution.focusedDrilldowns.job.job.qualityImpact.failedCountOnJobNetwork} ·
                active degradation{" "}
                {ops.routeReprobeExecution.focusedDrilldowns.job.job.qualityImpact.activeDegradationOnJobNetwork ? "yes" : "no"}
              </small>
              {ops.routeReprobeExecution.focusedDrilldowns.job.relatedFailures.map((failure) => (
                <small key={`focus-job-failure-${failure.failureKey}`}>
                  failure {formatFailureKey(failure.failureKey)} · failed events {failure.failedEventCount} · retries{" "}
                  {failure.retryScheduledCount}
                </small>
              ))}
              {ops.routeReprobeExecution.focusedDrilldowns.job.attemptTrail.map((entry) => (
                <small key={`focus-job-timeline-${entry.jobId}-${entry.at}-${entry.event}`}>
                  {formatRouteReprobeAttemptEvent(entry.event)} · attempt {entry.attempt} · {formatDateTime(entry.at)}
                  {entry.workerId ? ` · ${shortWorkerId(entry.workerId)}` : ""}
                  {entry.message ? ` · ${entry.message}` : ""}
                </small>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <div className="opsSection">
        <h2>Worker execution</h2>
        <div className="serverList">
          <div className="serverButton">
            <span>Lifecycle</span>
            <small>
              queued {ops.routeReprobeExecution.totals.queuedJobs} · running{" "}
              {ops.routeReprobeExecution.totals.runningJobs} · completed{" "}
              {ops.routeReprobeExecution.totals.completedJobs}
            </small>
            <small>
              dead letter {ops.routeReprobeExecution.totals.deadLetterJobs} · retries{" "}
              {ops.routeReprobeExecution.totals.retryScheduledCount} · reclaims{" "}
              {ops.routeReprobeExecution.totals.leaseReclaimedCount}
            </small>
            <small>
              completion {formatSuccessRate(ops.routeReprobeExecution.totals.completionRate)} · dead-letter{" "}
              {formatSuccessRate(ops.routeReprobeExecution.totals.deadLetterRate)}
            </small>
          </div>
          <div className="serverButton">
            <span>Queue health</span>
            <small>
              overdue queued {ops.routeReprobeExecution.totals.overdueQueuedJobs} · stale running{" "}
              {ops.routeReprobeExecution.totals.staleRunningJobs}
            </small>
            <small>
              oldest queued {formatMinutes(ops.routeReprobeExecution.timing.oldestQueuedAgeMinutes)} · longest running{" "}
              {formatMinutes(ops.routeReprobeExecution.timing.longestRunningAgeMinutes)}
            </small>
            <small>
              active workers {ops.routeReprobeExecution.workerHealth.activeWorkerCount}
            </small>
          </div>
          <div className="serverButton">
            <span>Execution timing</span>
            <small>
              start avg {formatMinutes(ops.routeReprobeExecution.timing.averageTimeToStartMinutes)} · p95{" "}
              {formatMinutes(ops.routeReprobeExecution.timing.p95TimeToStartMinutes)}
            </small>
            <small>
              lifecycle avg {formatMinutes(ops.routeReprobeExecution.timing.averageLifecycleMinutes)} · p95{" "}
              {formatMinutes(ops.routeReprobeExecution.timing.p95LifecycleMinutes)}
            </small>
            <small>
              retry rate {formatSuccessRate(ops.routeReprobeExecution.totals.retryRate)}
            </small>
          </div>
          <div className="serverButton">
            <span>Worker activity</span>
            <small>
              latest activity {formatDateTime(ops.routeReprobeExecution.workerHealth.latestWorkerActivityAt)}
            </small>
            <small>
              last claimed {formatDateTime(ops.routeReprobeExecution.workerHealth.lastClaimedAt)}
            </small>
            <small>
              last completed {formatDateTime(ops.routeReprobeExecution.workerHealth.lastCompletedAt)}
            </small>
          </div>
        </div>
      </div>

      <div className="opsSection">
        <h2>Worker-specific alerts</h2>
        <div className="serverList">
          {ops.routeReprobeExecution.workerAlerts.length ? (
            ops.routeReprobeExecution.workerAlerts.map((alert) => (
              <div className="serverButton" key={alert.id}>
                <span>
                  {formatAlertSeverity(alert.severity)} · {alert.title} · {shortWorkerId(alert.workerId)}
                </span>
                <small>{alert.detail}</small>
                <small>latest activity {formatDateTime(alert.latestActivityAt)}</small>
              </div>
            ))
          ) : (
            <div className="serverButton">
              <span>No worker-specific alerts in the current window.</span>
            </div>
          )}
        </div>
      </div>

      <div className="opsSection">
        <h2>Worker hotspots</h2>
        <div className="serverList">
          {ops.routeReprobeExecution.workerHotspots.length ? (
            ops.routeReprobeExecution.workerHotspots.map((worker) => (
              <div className="serverButton" key={worker.workerId}>
                <span>{shortWorkerId(worker.workerId)}</span>
                <small>
                  active jobs {worker.activeJobs} · claimed {worker.claimedJobs} · completed {worker.completedJobs}
                </small>
                <small>
                  dead letter {worker.deadLetterJobs} · retries {worker.retryScheduledCount} · failed events{" "}
                  {worker.failedEventCount}
                </small>
                <small>
                  lease reclaims {worker.leaseReclaimedCount} · stale running {worker.staleRunningJobs}
                </small>
                <small>
                  last claimed {formatDateTime(worker.lastClaimedAt)} · last completed {formatDateTime(worker.lastCompletedAt)}
                </small>
                <small>
                  latest activity {formatDateTime(worker.latestActivityAt)} · jobs{" "}
                  {worker.sampleJobIds.map((jobId) => jobId.slice(0, 8)).join(", ") || "—"}
                </small>
                <small>failure keys {worker.failureKeys.join(", ") || "—"}</small>
              </div>
            ))
          ) : (
            <div className="serverButton">
              <span>No worker hotspots yet.</span>
            </div>
          )}
        </div>
      </div>

      <div className="opsSection">
        <h2>Job network hotspots</h2>
        <div className="serverList">
          {ops.routeReprobeExecution.networkHotspots.length ? (
            ops.routeReprobeExecution.networkHotspots.map((hotspot) => (
              <div className="serverButton" key={hotspot.networkKey}>
                <span>
                  {formatNetworkSummary({
                    networkFingerprintId: null,
                    networkType: hotspot.network.networkType ?? null,
                    carrier: hotspot.network.carrier ?? null,
                    asn: hotspot.network.asn ?? null,
                    countryCode: hotspot.network.countryCode ?? null,
                    region: hotspot.network.region ?? null,
                    feedbackEvents: hotspot.feedbackEvents,
                    connectedCount: hotspot.connectedCount,
                    unstableCount: hotspot.unstableCount,
                    failedCount: hotspot.failedCount,
                    successRate:
                      hotspot.feedbackEvents > 0 ? hotspot.connectedCount / hotspot.feedbackEvents : 0,
                    lastEventAt: hotspot.latestQualityEventAt ?? hotspot.latestJobAt ?? ops.generatedAt,
                  })}
                </span>
                <small>
                  jobs {hotspot.totalJobs} · queued/running {hotspot.queuedJobs + hotspot.runningJobs} · completed{" "}
                  {hotspot.completedJobs} · dead letter {hotspot.deadLetterJobs}
                </small>
                <small>
                  feedback {hotspot.feedbackEvents} · failed {hotspot.failedCount} · unstable{" "}
                  {hotspot.unstableCount} · fallback resolves {hotspot.fallbackResolves}
                </small>
                <small>
                  active degradation {hotspot.activeDegradation ? "yes" : "no"} · duration{" "}
                  {formatMinutes(hotspot.activeDegradationMinutes)} · dominant failure{" "}
                  {formatFailureReason(hotspot.dominantFailureReason)}
                </small>
                <small>
                  latest job {formatDateTime(hotspot.latestJobAt)} · latest quality{" "}
                  {formatDateTime(hotspot.latestQualityEventAt)}
                </small>
                <small>jobs {hotspot.sampleJobIds.map((jobId) => jobId.slice(0, 8)).join(", ") || "—"}</small>
              </div>
            ))
          ) : (
            <div className="serverButton">
              <span>No reprobe network hotspots yet.</span>
            </div>
          )}
        </div>
      </div>

      <div className="opsSection">
        <h2>Worker failure drilldown</h2>
        <div className="serverList">
          {ops.routeReprobeExecution.failureDrilldown.length ? (
            ops.routeReprobeExecution.failureDrilldown.map((failure) => (
              <div className="serverButton" key={failure.failureKey}>
                <span>{formatFailureKey(failure.failureKey)}</span>
                <small>
                  affected jobs {failure.affectedJobs} · failed events {failure.failedEventCount} · retries{" "}
                  {failure.retryScheduledCount}
                </small>
                <small>
                  dead letter {failure.deadLetterJobs} · lease reclaims {failure.leaseReclaimedCount}
                </small>
                <small>
                  latest {formatDateTime(failure.latestAt)} · jobs {failure.sampleJobIds.map((jobId) => jobId.slice(0, 8)).join(", ")}
                </small>
              </div>
            ))
          ) : (
            <div className="serverButton">
              <span>No persisted failure clusters in the current window.</span>
            </div>
          )}
        </div>
      </div>

      <div className="opsSection">
        <h2>Worker timeline</h2>
        <div className="serverList">
          {ops.routeReprobeExecution.timeline.length ? (
            ops.routeReprobeExecution.timeline.map((entry) => (
              <div className="serverButton" key={`${entry.jobId}-${entry.at}-${entry.event}-${entry.attempt}`}>
                <span>
                  {formatRouteReprobeAttemptEvent(entry.event)} · {entry.jobId.slice(0, 8)} ·{" "}
                  {formatRouteReprobeJobStatus(entry.jobStatus)}
                </span>
                <small>
                  {formatDateTime(entry.at)} · attempt {entry.attempt}
                  {entry.workerId ? ` · ${entry.workerId.slice(0, 8)}` : ""}
                </small>
                <small>{formatNetworkSummary({
                  networkFingerprintId: null,
                  networkType: entry.network.networkType ?? null,
                  carrier: entry.network.carrier ?? null,
                  asn: entry.network.asn ?? null,
                  countryCode: entry.network.countryCode ?? null,
                  region: entry.network.region ?? null,
                  feedbackEvents: 0,
                  connectedCount: 0,
                  unstableCount: 0,
                  failedCount: 0,
                  successRate: 0,
                  lastEventAt: entry.at,
                })}</small>
                {entry.message ? <small>{entry.message}</small> : null}
              </div>
            ))
          ) : (
            <div className="serverButton">
              <span>No persisted timeline entries in the current window.</span>
            </div>
          )}
        </div>
      </div>

      <div className="opsSection">
        <h2>Explainable quality metrics</h2>
        <div className="serverList">
          <div className="serverButton">
            <span>Execution impact</span>
            <small>
              attention {formatExecutionImpactAttention(ops.qualityMetrics.executionImpact.attentionLevel)} · active degraded
              networks {ops.qualityMetrics.executionImpact.activeDegradedNetworks}
            </small>
            <small>
              impacted queued/running {ops.qualityMetrics.executionImpact.queuedOrRunningJobsOnActiveDegradedNetworks} ·
              dead letter {ops.qualityMetrics.executionImpact.deadLetterJobsOnActiveDegradedNetworks}
            </small>
            <small>
              since last success {ops.qualityMetrics.executionImpact.qualityEventsSinceLastSuccessfulCompletion} feedback ·{" "}
              {ops.qualityMetrics.executionImpact.fallbackResolvesSinceLastSuccessfulCompletion} fallback resolve ·{" "}
              {ops.qualityMetrics.executionImpact.degradationStartsSinceLastSuccessfulCompletion} degradation starts
            </small>
            <small>
              last successful completion {formatDateTime(ops.qualityMetrics.executionImpact.lastSuccessfulCompletionAt)} ·{" "}
              age {formatMinutes(ops.qualityMetrics.executionImpact.minutesSinceLastSuccessfulCompletion)}
            </small>
          </div>
          <div className="serverButton">
            <span>Fallback pressure</span>
            <small>
              {ops.qualityMetrics.fallbackPressure.fallbackCount} / {ops.qualityMetrics.fallbackPressure.observationCount}{" "}
              runtime reprobe snapshots ушли в fallback
            </small>
            <small>
              rate {formatSuccessRate(ops.qualityMetrics.fallbackPressure.fallbackRate)} · причина{" "}
              {formatAssignmentReason(ops.qualityMetrics.fallbackPressure.dominantFallbackReason)}
            </small>
            <small>
              last trigger {formatDateTime(ops.qualityMetrics.fallbackPressure.lastTriggeredAt)}
            </small>
          </div>
          <div className="serverButton">
            <span>Degradation windows</span>
            <small>
              active {ops.qualityMetrics.degradationWindows.active} · resolved{" "}
              {ops.qualityMetrics.degradationWindows.resolved} · total{" "}
              {ops.qualityMetrics.degradationWindows.total}
            </small>
            <small>
              endpoints {ops.qualityMetrics.degradationWindows.affectedEndpoints} · networks{" "}
              {ops.qualityMetrics.degradationWindows.affectedNetworks}
            </small>
            <small>
              longest active {formatMinutes(ops.qualityMetrics.degradationWindows.longestActiveMinutes)} · last start{" "}
              {formatDateTime(ops.qualityMetrics.degradationWindows.lastStartedAt)}
            </small>
          </div>
          <div className="serverButton">
            <span>Recovery time</span>
            <small>
              avg {formatMinutes(ops.qualityMetrics.recoveryTime.averageMinutes)} · median{" "}
              {formatMinutes(ops.qualityMetrics.recoveryTime.medianMinutes)}
            </small>
            <small>
              resolved windows {ops.qualityMetrics.recoveryTime.resolvedWindowCount}
            </small>
            <small>
              last recovered {formatDateTime(ops.qualityMetrics.recoveryTime.lastRecoveredAt)}
            </small>
          </div>
          <div className="serverButton">
            <span>SLA windows</span>
            <small>
              healthy {ops.qualityMetrics.slaWindows.healthy} · breached{" "}
              {ops.qualityMetrics.slaWindows.breached} · total{" "}
              {ops.qualityMetrics.slaWindows.total}
            </small>
            <small>
              target {formatSuccessRate(ops.qualityMetrics.slaWindows.availabilityTarget)} · breach rate{" "}
              {formatSuccessRate(ops.qualityMetrics.slaWindows.breachRate)}
            </small>
            <small>
              streak {ops.qualityMetrics.slaWindows.currentHealthyStreak} windows · last breach{" "}
              {formatDateTime(ops.qualityMetrics.slaWindows.lastBreachAt)}
            </small>
          </div>
        </div>
      </div>

      <div className="opsSection">
        <h2>Provider / ASN pressure</h2>
        <div className="serverList">
          {ops.qualityMetrics.providerPressure.map((pressure) => (
            <FailureDomainPressureTile
              key={`${pressure.domainType}:${pressure.domainKey}`}
              pressure={pressure}
            />
          ))}
          {ops.qualityMetrics.asnPressure.map((pressure) => (
            <FailureDomainPressureTile
              key={`${pressure.domainType}:${pressure.domainKey}`}
              pressure={pressure}
            />
          ))}
          {!ops.qualityMetrics.providerPressure.length &&
          !ops.qualityMetrics.asnPressure.length ? (
            <div className="serverButton">
              <span>Пока нет pressure-сигналов по failure domains.</span>
            </div>
          ) : null}
        </div>
      </div>

      <div className="opsSection">
        <h2>Recovery by failure domain</h2>
        <div className="serverList">
          {ops.qualityMetrics.recoveryByFailureDomain.length ? (
            ops.qualityMetrics.recoveryByFailureDomain.map((domain) => (
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

      <div className="opsSection">
        <h2>Recent reprobe jobs</h2>
        <div className="serverList">
          {ops.routeReprobeExecution.recentJobs.length ? (
            ops.routeReprobeExecution.recentJobs.map((job) => (
              <RouteReprobeJobTile key={job.id} job={job} />
            ))
          ) : (
            <div className="serverButton">
              <span>За выбранное окно пока нет persisted reprobe jobs.</span>
            </div>
          )}
        </div>
      </div>

      <div className="opsSection">
        <h2>Проблемные endpoint-ы</h2>
        <div className="serverList">
          {ops.endpoints.length ? (
            ops.endpoints.map((ep) => <EndpointTile key={ep.endpointId} endpoint={ep} />)
          ) : (
            <div className="serverButton">
              <span>За выбранное окно пока нет route feedback.</span>
            </div>
          )}
        </div>
      </div>

      <div className="opsSection">
        <h2>Сети с деградацией</h2>
        <div className="serverList">
          {ops.networks.length
            ? ops.networks.map((net) => <NetworkTile key={net.networkFingerprintId ?? `${net.networkType}-${net.carrier}-${net.asn}`} network={net} />)
            : null}
        </div>
      </div>

      <div className="opsSection">
        <div className="opsHeaderRow">
          <h2>Последние route events</h2>
          <button className="ghostButton" onClick={onReload} disabled={isSubmitting}>
            Обновить
          </button>
        </div>
        <div className="serverList">
          {ops.recentEvents.map((event) => (
            <EventTile key={event.id} event={event} />
          ))}
        </div>
      </div>
    </>
  );
}

/* ──────────────── Tile sub-components ──────────────── */

function formatDateTime(value: string | null) {
  return value ? new Date(value).toLocaleString("ru-RU") : "—";
}

function formatMinutes(value: number | null) {
  return typeof value === "number" ? `${value.toFixed(1)} min` : "—";
}

function formatExecutionImpactAttention(value: RouteDecisionOpsSummary["qualityMetrics"]["executionImpact"]["attentionLevel"]) {
  return value === "critical" ? "critical" : value === "watch" ? "watch" : "stable";
}

function formatOperationalSeverity(value: RouteDecisionOpsSummary["operationalSummary"]["overallSeverity"]) {
  return value === "critical" ? "critical" : value === "watch" ? "watch" : "ok";
}

function formatAlertSeverity(value: RouteDecisionOpsSummary["operationalSummary"]["alerts"][number]["severity"]) {
  return value === "critical" ? "critical" : "watch";
}

function formatInventoryRisk(value: RouteDecisionOpsSummary["operationalSummary"]["inventoryHealth"]["riskLevel"]) {
  return value === "critical" ? "critical" : value === "watch" ? "watch" : "ok";
}

function formatPersistedAlertStatus(value: OpsAlertSummary["status"]) {
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

function formatFailureKey(value: string) {
  return value === "lease_expired_before_completion" ? "Lease expired before completion" : value;
}

function formatHistoryEnd(value: string) {
  return new Date(value).toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDay(value: string) {
  return new Date(value).toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function shortWorkerId(value: string) {
  return value.length > 8 ? value.slice(0, 8) : value;
}

function EndpointTile({
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

function NetworkTile({
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

function EventTile({
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

function FailureDomainPressureTile({
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

function FailureDomainRecoveryTile({
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

function RouteReprobeJobTile({
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

function PersistedAlertTile({
  alert,
  escalationPreview,
  deliveries,
  isSubmitting,
  onAcknowledgeAlert,
  onSnoozeAlert,
  onUnacknowledgeAlert,
  onLoadEscalationPreview,
  onLoadAlertDeliveries,
  onDeliverAlert,
  onRetryAlertDelivery,
  onResendAlertDelivery,
}: {
  alert: OpsAlertSummary;
  escalationPreview: OpsAlertEscalationPreview | null;
  deliveries: OpsAlertDeliverySummary[];
  isSubmitting: boolean;
  onAcknowledgeAlert: (alertId: string) => Promise<void>;
  onSnoozeAlert: (alertId: string, minutes?: number) => Promise<void>;
  onUnacknowledgeAlert: (alertId: string) => Promise<void>;
  onLoadEscalationPreview: (alertId: string) => Promise<void>;
  onLoadAlertDeliveries: (alertId: string) => Promise<void>;
  onDeliverAlert: (alertId: string) => Promise<void>;
  onRetryAlertDelivery: (alertId: string, deliveryId: string) => Promise<void>;
  onResendAlertDelivery: (alertId: string, deliveryId: string) => Promise<void>;
}) {
  const inventoryAlertMetadata = readInventoryAlertMetadata(alert.metadata);
  const escalationMessageLines = escalationPreview
    ? escalationPreview.recommendedMessage
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
    : [];

  return (
    <div className="serverButton">
      <span>
        {formatAlertSeverity(alert.severity)} · {formatPersistedAlertStatus(alert.status)} · {alert.title}
      </span>
      <small>{alert.detail}</small>
      {inventoryAlertMetadata ? (
        <>
          <small>
            inventory counts · endpoints {inventoryAlertMetadata.activeInventoryEndpoints ?? "—"} · providers{" "}
            {inventoryAlertMetadata.distinctInventoryProviders ?? "—"} · ASN{" "}
            {inventoryAlertMetadata.distinctInventoryAsns ?? "—"} · regions{" "}
            {inventoryAlertMetadata.distinctInventoryRegions ?? "—"}
          </small>
          <small>
            policy target {inventoryAlertMetadata.minimumRecommendedFailureDomains ?? "—"} ·{" "}
            {inventoryAlertMetadata.inventoryFailedDimensions.length
              ? inventoryAlertMetadata.inventoryFailedDimensions.join(" · ")
              : "Policy satisfied"}
          </small>
        </>
      ) : null}
      <small>
        started {formatDateTime(alert.startedAt)} · last detected {formatDateTime(alert.lastDetectedAt)}
      </small>
      <small>
        acknowledged {formatDateTime(alert.acknowledgedAt)} · snoozed until {formatDateTime(alert.snoozedUntil)}
      </small>
      <small>
        dedupe {alert.dedupeKey}
      </small>
      {alert.severity === "watch" ? <small>delivery path · shared watch digest batch</small> : null}
      <div className="opsActionRow">
        <button
          className="ghostButton"
          disabled={isSubmitting}
          onClick={() => void onLoadEscalationPreview(alert.id)}
        >
          Preview escalation
        </button>
        <button
          className="ghostButton"
          disabled={isSubmitting}
          onClick={() => void onLoadAlertDeliveries(alert.id)}
        >
          Delivery log
        </button>
        {alert.severity === "critical" ? (
          <button
            className="ghostButton"
            disabled={isSubmitting}
            onClick={() => void onDeliverAlert(alert.id)}
          >
            Send now
          </button>
        ) : null}
        {alert.status !== "acknowledged" ? (
          <button
            className="ghostButton"
            disabled={isSubmitting}
            onClick={() => void onAcknowledgeAlert(alert.id)}
          >
            Acknowledge
          </button>
        ) : null}
        {alert.status !== "snoozed" ? (
          <button
            className="ghostButton"
            disabled={isSubmitting}
            onClick={() => void onSnoozeAlert(alert.id, 60)}
          >
            Snooze 1h
          </button>
        ) : null}
        {alert.status !== "active" ? (
          <button
            className="ghostButton"
            disabled={isSubmitting}
            onClick={() => void onUnacknowledgeAlert(alert.id)}
          >
            Reopen
          </button>
        ) : null}
      </div>
      {escalationPreview ? (
        <>
          <small>
            escalation {escalationPreview.escalationLevel} · {escalationPreview.shouldEscalate ? "send" : "hold"} ·{" "}
            recipients {escalationPreview.recipients.length}
          </small>
          <small>preview subject · {escalationPreview.recommendedSubject}</small>
          <small>preview reason · {escalationPreview.reason}</small>
          {escalationMessageLines.map((line, index) => (
            <small key={`${alert.id}-preview-line-${index}`}>
              {index === 0 ? "preview title" : line.startsWith("Status:")
                ? "preview status"
                : line.startsWith("Severity:")
                  ? "preview severity"
                  : line.startsWith("Last detected:")
                    ? "preview last detected"
                    : line.startsWith("Escalation:")
                      ? "preview escalation"
                      : line.startsWith("Why:")
                        ? "preview why"
                        : line.startsWith("Failed dimensions:")
                          ? "preview failed dimensions"
                          : line.startsWith("Inventory counts:")
                            ? "preview inventory counts"
                            : line.startsWith("Policy target:")
                              ? "preview policy target"
                              : index === 1
                                ? "preview detail"
                                : "preview body"}{" "}
              · {line}
            </small>
          ))}
          {escalationPreview.recipients.map((recipient) => (
            <small key={`${alert.id}-${recipient.userId}-${recipient.channel}`}>
              step {recipient.chainStep} · {recipient.escalationTier} · {recipient.channel} · {recipient.displayName} · {recipient.contact}
            </small>
          ))}
        </>
      ) : null}
      {deliveries.length ? (
        <>
          <small>
            recent delivery batch {deliveries[0]?.batchId.slice(0, 8)} · entries {deliveries.length}
          </small>
          {deliveries.map((delivery) => (
            <div key={delivery.id}>
              <small>
                {delivery.status} · {delivery.channel} · {delivery.deliveryPath} · {delivery.recipientDisplayName} ·{" "}
                {delivery.recipientContact} · {formatDateTime(delivery.deliveredAt ?? delivery.createdAt)}
              </small>
              {delivery.providerMessageId ? <small>provider message · {delivery.providerMessageId}</small> : null}
              {typeof delivery.metadata.failureReason === "string" ? (
                <small>failure reason · {delivery.metadata.failureReason}</small>
              ) : null}
              {delivery.status === "delivered" ? (
                <div className="opsActionRow">
                  <button
                    className="ghostButton"
                    disabled={isSubmitting}
                    onClick={() => void onResendAlertDelivery(alert.id, delivery.id)}
                  >
                    Send again
                  </button>
                </div>
              ) : null}
              {delivery.status === "failed" ? (
                <div className="opsActionRow">
                  <button
                    className="ghostButton"
                    disabled={isSubmitting}
                    onClick={() => void onRetryAlertDelivery(alert.id, delivery.id)}
                  >
                    Retry failed
                  </button>
                </div>
              ) : null}
            </div>
          ))}
        </>
      ) : null}
    </div>
  );
}

function readInventoryAlertMetadata(metadata: Record<string, unknown>) {
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
