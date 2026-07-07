import type {
  AuthSession,
  AccountSummary,
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
  formatRouteReprobeAttemptEvent,
  formatRouteReprobeJobStatus,
  formatSuccessRate,
  formatNetworkSummary,
} from "../lib/formatters";

interface Props {
  auth: AuthSession | null;
  account: AccountSummary | null;
  routeDecisionOps: RouteDecisionOpsSummary | null;
  isSubmitting: boolean;
  onReload: () => void;
}

export function OpsScreen({
  auth,
  account,
  routeDecisionOps,
  isSubmitting,
  onReload,
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
          isSubmitting={isSubmitting}
          onReload={onReload}
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
  isSubmitting: boolean;
  onReload: () => void;
}

function OpsDashboard({ ops, isSubmitting, onReload }: OpsDashboardProps) {
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
        <h2>Explainable quality metrics</h2>
        <div className="serverList">
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
