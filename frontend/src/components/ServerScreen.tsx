import type { Session, ServerOption, RoutePolicy } from "../types";

interface Props {
  session: Session | null;
  servers: ServerOption[];
  routePolicy: RoutePolicy | null;
  isSubmitting: boolean;
  onChangeServer: (serverId: string) => void;
}

export function ServerScreen({
  session,
  servers,
  routePolicy,
  isSubmitting,
  onChangeServer,
}: Props) {
  // Быстрее всего — это то, что реально подставится при авто-подключении
  // (routePolicy), а не просто минимальный latencyMs "по бумаге".
  const fastestId =
    routePolicy?.recommendedEndpointId ??
    [...servers]
      .filter((server) => server.latencyMeasuredAt)
      .sort((a, b) => a.latencyMs - b.latencyMs)[0]?.id ??
    null;

  const sortedServers = [...servers].sort((a, b) => {
    if (a.id === fastestId) return -1;
    if (b.id === fastestId) return 1;
    // Непроверенные (никогда не пинговавшиеся) серверы не должны обгонять
    // реально измеренные по случайному старому значению latencyMs.
    if (!a.latencyMeasuredAt && !b.latencyMeasuredAt) return 0;
    if (!a.latencyMeasuredAt) return 1;
    if (!b.latencyMeasuredAt) return -1;
    return a.latencyMs - b.latencyMs;
  });

  return (
    <>
      <h1>Выбор сервера</h1>
      <p className="hint">
        Мы сами подбираем самый быстрый сервер. Можно выбрать другой —
        просто нажми.
      </p>

      <div className="serverList">
        {sortedServers.map((server) => (
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
            <span>
              {server.label}
              {server.id === fastestId ? (
                <span className="serverBadge">⚡ Быстрее всего</span>
              ) : null}
            </span>
            <small>
              {server.region} · {server.latencyMeasuredAt ? `${server.latencyMs} мс` : "нет данных о пинге"}
            </small>
          </button>
        ))}
      </div>
    </>
  );
}
