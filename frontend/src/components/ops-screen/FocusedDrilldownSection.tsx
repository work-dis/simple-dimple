import type { RouteDecisionOpsSummary } from "../../types";
import {
  formatFailureReason,
  formatNetworkSummary,
  formatRouteReprobeAttemptEvent,
  formatRouteReprobeJobStatus,
} from "../../lib/formatters";
import { formatDateTime, formatFailureKey, formatMinutes, shortWorkerId } from "./formatters";

export function FocusedDrilldownSection({
  focusedDrilldowns,
  generatedAt,
}: {
  focusedDrilldowns: RouteDecisionOpsSummary["routeReprobeExecution"]["focusedDrilldowns"];
  generatedAt: string;
}) {
  return (
    <div className="opsSection">
      <h2>Focused triage drilldown</h2>
      <div className="serverList">
        {focusedDrilldowns.worker ? (
          <div className="serverButton">
            <span>
              Worker focus · {shortWorkerId(focusedDrilldowns.worker.workerId)}
            </span>
            <small>
              alerts {focusedDrilldowns.worker.activeAlertCount} · active jobs{" "}
              {focusedDrilldowns.worker.activeJobs} · dead letter{" "}
              {focusedDrilldowns.worker.deadLetterJobs}
            </small>
            <small>
              retries {focusedDrilldowns.worker.retryScheduledCount} · failed events{" "}
              {focusedDrilldowns.worker.failedEventCount} · lease reclaims{" "}
              {focusedDrilldowns.worker.leaseReclaimedCount}
            </small>
            <small>
              stale running {focusedDrilldowns.worker.staleRunningJobs} · latest activity{" "}
              {formatDateTime(focusedDrilldowns.worker.latestActivityAt)}
            </small>
            <small>
              jobs {focusedDrilldowns.worker.sampleJobIds.map((jobId) => jobId.slice(0, 8)).join(", ") || "—"}
            </small>
            {focusedDrilldowns.worker.relatedFailures.map((failure) => (
              <small key={`focus-worker-failure-${failure.failureKey}`}>
                failure {formatFailureKey(failure.failureKey)} · jobs {failure.affectedJobs} · dead letter{" "}
                {failure.deadLetterJobs}
              </small>
            ))}
            {focusedDrilldowns.worker.recentTimeline.map((entry) => (
              <small key={`focus-worker-timeline-${entry.jobId}-${entry.at}-${entry.event}`}>
                {formatRouteReprobeAttemptEvent(entry.event)} · {entry.jobId.slice(0, 8)} · attempt {entry.attempt} ·{" "}
                {formatDateTime(entry.at)}
              </small>
            ))}
          </div>
        ) : null}
        {focusedDrilldowns.network ? (
          <div className="serverButton">
            <span>
              Network focus · {formatNetworkSummary({
                networkFingerprintId: null,
                networkType: focusedDrilldowns.network.network.networkType ?? null,
                carrier: focusedDrilldowns.network.network.carrier ?? null,
                asn: focusedDrilldowns.network.network.asn ?? null,
                countryCode: focusedDrilldowns.network.network.countryCode ?? null,
                region: focusedDrilldowns.network.network.region ?? null,
                feedbackEvents: focusedDrilldowns.network.feedbackEvents,
                connectedCount: focusedDrilldowns.network.connectedCount,
                unstableCount: focusedDrilldowns.network.unstableCount,
                failedCount: focusedDrilldowns.network.failedCount,
                successRate:
                  focusedDrilldowns.network.feedbackEvents > 0
                    ? focusedDrilldowns.network.connectedCount /
                      focusedDrilldowns.network.feedbackEvents
                    : 0,
                lastEventAt:
                  focusedDrilldowns.network.latestQualityEventAt ??
                  focusedDrilldowns.network.latestJobAt ??
                  generatedAt,
              })}
            </span>
            <small>
              queued/running {focusedDrilldowns.network.queuedOrRunningJobs} · dead letter{" "}
              {focusedDrilldowns.network.deadLetterJobs}
            </small>
            <small>
              feedback {focusedDrilldowns.network.feedbackEvents} · failed{" "}
              {focusedDrilldowns.network.failedCount} · fallback resolves{" "}
              {focusedDrilldowns.network.fallbackResolves}
            </small>
            <small>
              active degradation {focusedDrilldowns.network.activeDegradation ? "yes" : "no"} · duration{" "}
              {formatMinutes(focusedDrilldowns.network.activeDegradationMinutes)} · dominant failure{" "}
              {formatFailureReason(focusedDrilldowns.network.dominantFailureReason)}
            </small>
            <small>
              latest job {formatDateTime(focusedDrilldowns.network.latestJobAt)} · latest quality{" "}
              {formatDateTime(focusedDrilldowns.network.latestQualityEventAt)}
            </small>
            {focusedDrilldowns.network.relatedJobs.map((job) => (
              <small key={`focus-network-job-${job.id}`}>
                job {job.id.slice(0, 8)} · {formatRouteReprobeJobStatus(job.status)} · latest{" "}
                {formatRouteReprobeAttemptEvent(job.latestAttemptEvent)} · {formatDateTime(job.latestAttemptAt)}
              </small>
            ))}
          </div>
        ) : null}
        {focusedDrilldowns.job ? (
          <div className="serverButton">
            <span>
              Job focus · {focusedDrilldowns.job.job.id.slice(0, 8)} ·{" "}
              {formatRouteReprobeJobStatus(focusedDrilldowns.job.job.status)}
            </span>
            <small>
              attempts {focusedDrilldowns.job.job.attempts}/
              {focusedDrilldowns.job.job.maxAttempts} · lifecycle{" "}
              {formatMinutes(focusedDrilldowns.job.job.lifecycleMinutes)}
            </small>
            <small>
              workers {focusedDrilldowns.job.relatedWorkerIds.map(shortWorkerId).join(", ") || "—"} ·
              latest {formatRouteReprobeAttemptEvent(focusedDrilldowns.job.job.latestAttemptEvent)} ·{" "}
              {formatDateTime(focusedDrilldowns.job.job.latestAttemptAt)}
            </small>
            <small>
              network feedback {focusedDrilldowns.job.job.qualityImpact.feedbackEventsOnJobNetwork} ·
              failed {focusedDrilldowns.job.job.qualityImpact.failedCountOnJobNetwork} ·
              active degradation{" "}
              {focusedDrilldowns.job.job.qualityImpact.activeDegradationOnJobNetwork ? "yes" : "no"}
            </small>
            {focusedDrilldowns.job.relatedFailures.map((failure) => (
              <small key={`focus-job-failure-${failure.failureKey}`}>
                failure {formatFailureKey(failure.failureKey)} · failed events {failure.failedEventCount} · retries{" "}
                {failure.retryScheduledCount}
              </small>
            ))}
            {focusedDrilldowns.job.attemptTrail.map((entry) => (
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
  );
}
