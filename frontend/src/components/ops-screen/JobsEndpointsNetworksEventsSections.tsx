import type { RouteDecisionOpsSummary } from "../../types";
import { EndpointTile, EventTile, NetworkTile, RouteReprobeJobTile } from "./tiles";

export function RecentJobsSection({
  recentJobs,
}: {
  recentJobs: RouteDecisionOpsSummary["routeReprobeExecution"]["recentJobs"];
}) {
  return (
    <div className="opsSection">
      <h2>Recent reprobe jobs</h2>
      <div className="serverList">
        {recentJobs.length ? (
          recentJobs.map((job) => <RouteReprobeJobTile key={job.id} job={job} />)
        ) : (
          <div className="serverButton">
            <span>За выбранное окно пока нет persisted reprobe jobs.</span>
          </div>
        )}
      </div>
    </div>
  );
}

export function EndpointsSection({
  endpoints,
}: {
  endpoints: RouteDecisionOpsSummary["endpoints"];
}) {
  return (
    <div className="opsSection">
      <h2>Проблемные endpoint-ы</h2>
      <div className="serverList">
        {endpoints.length ? (
          endpoints.map((ep) => <EndpointTile key={ep.endpointId} endpoint={ep} />)
        ) : (
          <div className="serverButton">
            <span>За выбранное окно пока нет route feedback.</span>
          </div>
        )}
      </div>
    </div>
  );
}

export function NetworksSection({
  networks,
}: {
  networks: RouteDecisionOpsSummary["networks"];
}) {
  return (
    <div className="opsSection">
      <h2>Сети с деградацией</h2>
      <div className="serverList">
        {networks.length
          ? networks.map((net) => (
              <NetworkTile key={net.networkFingerprintId ?? `${net.networkType}-${net.carrier}-${net.asn}`} network={net} />
            ))
          : null}
      </div>
    </div>
  );
}

export function RecentEventsSection({
  recentEvents,
  isSubmitting,
  onReload,
}: {
  recentEvents: RouteDecisionOpsSummary["recentEvents"];
  isSubmitting: boolean;
  onReload: () => void;
}) {
  return (
    <div className="opsSection">
      <div className="opsHeaderRow">
        <h2>Последние route events</h2>
        <button className="ghostButton" onClick={onReload} disabled={isSubmitting}>
          Обновить
        </button>
      </div>
      <div className="serverList">
        {recentEvents.map((event) => (
          <EventTile key={event.id} event={event} />
        ))}
      </div>
    </div>
  );
}
