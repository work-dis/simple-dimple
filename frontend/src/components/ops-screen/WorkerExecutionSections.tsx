import type { RouteDecisionOpsSummary } from "../../types";
import { formatSuccessRate } from "../../lib/formatters";
import { formatAlertSeverity, formatDateTime, formatMinutes, shortWorkerId } from "./formatters";

export function WorkerExecutionSection({
  execution,
}: {
  execution: RouteDecisionOpsSummary["routeReprobeExecution"];
}) {
  return (
    <div className="opsSection">
      <h2>Worker execution</h2>
      <div className="serverList">
        <div className="serverButton">
          <span>Lifecycle</span>
          <small>
            queued {execution.totals.queuedJobs} · running{" "}
            {execution.totals.runningJobs} · completed{" "}
            {execution.totals.completedJobs}
          </small>
          <small>
            dead letter {execution.totals.deadLetterJobs} · retries{" "}
            {execution.totals.retryScheduledCount} · reclaims{" "}
            {execution.totals.leaseReclaimedCount}
          </small>
          <small>
            completion {formatSuccessRate(execution.totals.completionRate)} · dead-letter{" "}
            {formatSuccessRate(execution.totals.deadLetterRate)}
          </small>
        </div>
        <div className="serverButton">
          <span>Queue health</span>
          <small>
            overdue queued {execution.totals.overdueQueuedJobs} · stale running{" "}
            {execution.totals.staleRunningJobs}
          </small>
          <small>
            oldest queued {formatMinutes(execution.timing.oldestQueuedAgeMinutes)} · longest running{" "}
            {formatMinutes(execution.timing.longestRunningAgeMinutes)}
          </small>
          <small>
            active workers {execution.workerHealth.activeWorkerCount}
          </small>
        </div>
        <div className="serverButton">
          <span>Execution timing</span>
          <small>
            start avg {formatMinutes(execution.timing.averageTimeToStartMinutes)} · p95{" "}
            {formatMinutes(execution.timing.p95TimeToStartMinutes)}
          </small>
          <small>
            lifecycle avg {formatMinutes(execution.timing.averageLifecycleMinutes)} · p95{" "}
            {formatMinutes(execution.timing.p95LifecycleMinutes)}
          </small>
          <small>
            retry rate {formatSuccessRate(execution.totals.retryRate)}
          </small>
        </div>
        <div className="serverButton">
          <span>Worker activity</span>
          <small>
            latest activity {formatDateTime(execution.workerHealth.latestWorkerActivityAt)}
          </small>
          <small>
            last claimed {formatDateTime(execution.workerHealth.lastClaimedAt)}
          </small>
          <small>
            last completed {formatDateTime(execution.workerHealth.lastCompletedAt)}
          </small>
        </div>
      </div>
    </div>
  );
}

export function WorkerAlertsSection({
  workerAlerts,
}: {
  workerAlerts: RouteDecisionOpsSummary["routeReprobeExecution"]["workerAlerts"];
}) {
  return (
    <div className="opsSection">
      <h2>Worker-specific alerts</h2>
      <div className="serverList">
        {workerAlerts.length ? (
          workerAlerts.map((alert) => (
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
  );
}

export function WorkerHotspotsSection({
  workerHotspots,
}: {
  workerHotspots: RouteDecisionOpsSummary["routeReprobeExecution"]["workerHotspots"];
}) {
  return (
    <div className="opsSection">
      <h2>Worker hotspots</h2>
      <div className="serverList">
        {workerHotspots.length ? (
          workerHotspots.map((worker) => (
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
  );
}
