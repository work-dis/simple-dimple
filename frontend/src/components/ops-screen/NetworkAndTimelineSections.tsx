import type { RouteDecisionOpsSummary } from "../../types";
import {
  formatFailureReason,
  formatNetworkSummary,
  formatRouteReprobeAttemptEvent,
  formatRouteReprobeJobStatus,
} from "../../lib/formatters";
import { formatDateTime, formatFailureKey, formatMinutes } from "./formatters";

export function NetworkHotspotsSection({
  networkHotspots,
  generatedAt,
}: {
  networkHotspots: RouteDecisionOpsSummary["routeReprobeExecution"]["networkHotspots"];
  generatedAt: string;
}) {
  return (
    <div className="opsSection">
      <h2>Job network hotspots</h2>
      <div className="serverList">
        {networkHotspots.length ? (
          networkHotspots.map((hotspot) => (
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
                  lastEventAt: hotspot.latestQualityEventAt ?? hotspot.latestJobAt ?? generatedAt,
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
  );
}

export function FailureDrilldownSection({
  failureDrilldown,
}: {
  failureDrilldown: RouteDecisionOpsSummary["routeReprobeExecution"]["failureDrilldown"];
}) {
  return (
    <div className="opsSection">
      <h2>Worker failure drilldown</h2>
      <div className="serverList">
        {failureDrilldown.length ? (
          failureDrilldown.map((failure) => (
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
  );
}

export function TimelineSection({
  timeline,
}: {
  timeline: RouteDecisionOpsSummary["routeReprobeExecution"]["timeline"];
}) {
  return (
    <div className="opsSection">
      <h2>Worker timeline</h2>
      <div className="serverList">
        {timeline.length ? (
          timeline.map((entry) => (
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
  );
}
