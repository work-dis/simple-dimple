import { formatFailureReason, formatRouteHealthStatus } from "../lib";
import type { RouteHealthSnapshot, ServerOption } from "../types";

interface Props {
  servers: ServerOption[];
  routeHealth: RouteHealthSnapshot[];
}

// Задача #15 (PRIORITY_PLAN.md) — реальная инфа о возможности соединения,
// а не просто пинг: те же RouteHealthSnapshot, что уже считает бэкенд для
// route-policy.ts и показывает admin Ops-экран, здесь — для самого
// пользователя, но осознанно вынесено за пределы Home (ROADMAP.md — одна
// большая кнопка, никакого дашборда на главном экране).
export function ServerAdvancedScreen({ servers, routeHealth }: Props) {
  return (
    <>
      <h1>Дополнительные настройки</h1>
      <p className="hint">
        Реальная возможность соединения по последним отчётам клиентов — не
        просто измеренный пинг.
      </p>

      {servers.length === 0 ? (
        <p className="hint">Список серверов пока пуст.</p>
      ) : (
        <div className="deviceList">
          {servers.map((server) => {
            const health = routeHealth.find((entry) => entry.endpointId === server.id);

            return (
              <div key={server.id} className="deviceCard">
                <span>{server.label}</span>
                <strong>{server.region}</strong>

                <div className="details">
                  <div>
                    <span>Статус</span>
                    <strong>{formatRouteHealthStatus(health?.status)}</strong>
                  </div>
                  <div>
                    <span>Уверенность оценки</span>
                    <strong>
                      {health ? `${Math.round(health.confidence * 100)}%` : "—"}
                    </strong>
                  </div>
                  <div>
                    <span>Недавних сбоев</span>
                    <strong>{health ? health.freshFailureCount : "—"}</strong>
                  </div>
                  <div>
                    <span>Основная причина сбоев</span>
                    <strong>{formatFailureReason(health?.dominantFailureReason)}</strong>
                  </div>
                  <div>
                    <span>Последний сбой</span>
                    <strong>
                      {health?.lastFailureAt
                        ? new Date(health.lastFailureAt).toLocaleString("ru-RU")
                        : "—"}
                    </strong>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
