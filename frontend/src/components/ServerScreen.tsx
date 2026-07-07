import type { Session, ServerOption, EndpointAssignment, RoutePolicy, RouteHealthSnapshot } from "../types";
import {
  formatAssignmentReason,
  formatPolicySelector,
  formatFailureReason,
  formatRouteHealthStatus,
  formatFallbackTier,
  formatDiversityStage,
} from "../lib/formatters";

interface Props {
  session: Session | null;
  servers: ServerOption[];
  activeServer: ServerOption | undefined;
  currentAssignment: EndpointAssignment | null;
  routePolicy: RoutePolicy | null;
  routeHealth: RouteHealthSnapshot[];
  isSubmitting: boolean;
  onChangeServer: (serverId: string) => void;
}

export function ServerScreen({
  session,
  servers,
  activeServer,
  currentAssignment,
  routePolicy,
  routeHealth,
  isSubmitting,
  onChangeServer,
}: Props) {
  const isConnected = session?.status === "connected";

  return (
    <>
      <h1>Выбор сервера</h1>
      <p className="hint">
        Отдельный экран без перегрузки главного сценария.
      </p>

      <div className="details">
        <div>
          <span>Текущий сервер</span>
          <strong>{activeServer ? activeServer.label : "Не выбран"}</strong>
        </div>
        <div>
          <span>Статус</span>
          <strong>{isConnected ? "Подключено" : "Не подключено"}</strong>
        </div>
        <div>
          <span>Assignment</span>
          <strong>{formatAssignmentReason(currentAssignment?.assignmentReason)}</strong>
        </div>
        <div>
          <span>Рекомендация</span>
          <strong>{formatAssignmentReason(routePolicy?.recommendedReason)}</strong>
        </div>
        <div>
          <span>Policy source</span>
          <strong>{formatPolicySelector(routePolicy?.trace.selectedBy)}</strong>
        </div>
        <div>
          <span>Fallback tier</span>
          <strong>{formatFallbackTier(routePolicy?.trace.fallbackTier)}</strong>
        </div>
        <div>
          <span>Diversity</span>
          <strong>{formatDiversityStage(routePolicy?.trace.diversityStageReached)}</strong>
        </div>
        <div>
          <span>Providers / ASN</span>
          <strong>
            {routePolicy
              ? `${routePolicy.trace.shortlistDistinctProviders} / ${routePolicy.trace.shortlistDistinctAsns}`
              : "—"}
          </strong>
        </div>
        <div>
          <span>Health penalties</span>
          <strong>
            {routePolicy
              ? `${routePolicy.trace.usedRouteHealthPenalties ? "yes" : "no"} · ${routePolicy.trace.routeHealthPenalizedCount}/${routePolicy.trace.routeHealthAvoidedCount}`
              : "—"}
          </strong>
        </div>
        <div>
          <span>Health-aware shortlist</span>
          <strong>
            {routePolicy
              ? `${routePolicy.trace.usedHealthAwareShortlist ? "yes" : "no"} · ${routePolicy.trace.shortlistPenalizedCount}`
              : "—"}
          </strong>
        </div>
        <div>
          <span>Health-aware primary</span>
          <strong>
            {routePolicy
              ? `${routePolicy.trace.usedHealthAwarePrimarySelection ? "yes" : "no"} · ${routePolicy.trace.healthAdjustedPrimaryEndpointId ?? "—"}`
              : "—"}
          </strong>
        </div>
        <div>
          <span>Top penalty</span>
          <strong>
            {routePolicy
              ? `${formatFailureReason(routePolicy.trace.topPenaltyReason)} · ${routePolicy.trace.topPenaltyConfidence !== null ? `${Math.round(routePolicy.trace.topPenaltyConfidence * 100)}%` : "—"}`
              : "—"}
          </strong>
        </div>
        <div>
          <span>Recommended health</span>
          <strong>
            {routePolicy
              ? `${formatRouteHealthStatus(routePolicy.trace.recommendedEndpointHealth)} · ${routePolicy.trace.recommendedEndpointPenaltyScore !== null ? routePolicy.trace.recommendedEndpointPenaltyScore.toFixed(1) : "—"}`
              : "—"}
          </strong>
        </div>
        <div>
          <span>Recommended reason</span>
          <strong>
            {routePolicy ? formatFailureReason(routePolicy.trace.recommendedEndpointFailureReason) : "—"}
          </strong>
        </div>
        <div>
          <span>Original primary</span>
          <strong>
            {routePolicy
              ? `${routePolicy.trace.primaryCandidateEndpointId ?? "—"} · ${formatRouteHealthStatus(routePolicy.trace.primaryCandidateHealth)} · ${routePolicy.trace.primaryCandidatePenaltyScore !== null ? routePolicy.trace.primaryCandidatePenaltyScore.toFixed(1) : "—"}`
              : "—"}
          </strong>
        </div>
      </div>

      {routePolicy?.shortlist.length ? (
        <div className="serverList">
          {routePolicy.shortlist.map((candidate, index) => (
            <button
              key={`${candidate.endpointId}-${candidate.assignmentReason}`}
              className={
                candidate.endpointId === session?.activeServerId
                  ? "serverButton active"
                  : "serverButton"
              }
              onClick={() => void onChangeServer(candidate.endpointId)}
              disabled={isSubmitting}
            >
              <span>
                #{index + 1} {candidate.label}
              </span>
              <small>
                {formatAssignmentReason(candidate.assignmentReason)} · {candidate.region} ·{" "}
                {candidate.latencyMs} ms
              </small>
            </button>
          ))}
        </div>
      ) : null}

      {routeHealth.length ? (
        <div className="serverList">
          {routeHealth.slice(0, 4).map((snapshot) => {
            const server = servers.find((s) => s.id === snapshot.endpointId);

            return (
              <button
                key={`health-${snapshot.endpointId}`}
                className={
                  snapshot.endpointId === session?.activeServerId
                    ? "serverButton active"
                    : "serverButton"
                }
                onClick={() => void onChangeServer(snapshot.endpointId)}
                disabled={isSubmitting}
              >
                <span>
                  {server?.label ?? snapshot.endpointId} ·{" "}
                  {formatRouteHealthStatus(snapshot.status)}
                </span>
                <small>
                  {formatFailureReason(snapshot.dominantFailureReason)} · penalty{" "}
                  {snapshot.penaltyScore.toFixed(1)} · confidence{" "}
                  {Math.round(snapshot.confidence * 100)}%
                </small>
              </button>
            );
          })}
        </div>
      ) : null}

      <div className="serverList">
        {servers.map((server) => (
          <button
            key={server.id}
            className={
              server.id === session?.activeServerId
                ? "serverButton active"
                : "serverButton"
            }
            onClick={() => void onChangeServer(server.id)}
            disabled={isSubmitting}
          >
            <span>{server.label}</span>
            <small>
              {server.region} · {server.latencyMs} ms · {server.loadPercent}%
            </small>
          </button>
        ))}
      </div>
    </>
  );
}
