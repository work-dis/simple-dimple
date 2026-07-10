import type { AdminEndpointSummary, RouteDecisionOpsSummary } from "../../types";
import { FleetEndpointTile } from "./tiles";
import { formatDateTime, formatDay, formatHistoryEnd, formatOperationalSeverity } from "./formatters";

export function FleetSection({
  adminEndpoints,
  isSubmitting,
  onRetireEndpoint,
  onReactivateEndpoint,
  onReloadEndpoints,
}: {
  adminEndpoints: AdminEndpointSummary[];
  isSubmitting: boolean;
  onRetireEndpoint: (endpoint: AdminEndpointSummary) => Promise<void>;
  onReactivateEndpoint: (endpoint: AdminEndpointSummary) => Promise<void>;
  onReloadEndpoints: () => Promise<void>;
}) {
  return (
    <div className="opsSection">
      <div className="opsHeaderRow">
        <h2>Fleet — Xray-ноды</h2>
        <button className="ghostButton" onClick={() => void onReloadEndpoints()} disabled={isSubmitting}>
          Refresh fleet
        </button>
      </div>
      <p className="hint">
        Регистрация новых нод — через provisioning-скрипт (deploy/xray/provision-node.sh),
        не отсюда. Retire/reactivate — ручное действие админа, Шаг 5 PRIORITY_PLAN.md.
      </p>
      <div className="serverList">
        {adminEndpoints.length ? (
          adminEndpoints.map((endpoint) => (
            <FleetEndpointTile
              key={endpoint.id}
              endpoint={endpoint}
              isSubmitting={isSubmitting}
              onRetire={onRetireEndpoint}
              onReactivate={onReactivateEndpoint}
            />
          ))
        ) : (
          <div className="serverButton">
            <span>Fleet пуст или ещё не загружен.</span>
          </div>
        )}
      </div>
    </div>
  );
}

export function HistorySection({
  history,
}: {
  history: RouteDecisionOpsSummary["operationalSummary"]["history"];
}) {
  return (
    <div className="opsSection">
      <h2>Recent ops history</h2>
      <div className="serverList">
        {history.length ? (
          history.map((window) => (
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
  );
}

export function DailyHistorySection({
  dailyHistory,
}: {
  dailyHistory: RouteDecisionOpsSummary["operationalSummary"]["dailyHistory"];
}) {
  return (
    <div className="opsSection">
      <h2>Daily ops history</h2>
      <div className="serverList">
        {dailyHistory.length ? (
          dailyHistory.map((window) => (
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
  );
}
