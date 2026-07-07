import type { Session, ServerOption, EndpointAssignment, RoutePolicy, Screen } from "../types";
import { formatAssignmentReason } from "../lib/formatters";

interface Props {
  session: Session | null;
  servers: ServerOption[];
  activeServer: ServerOption | undefined;
  currentAssignment: EndpointAssignment | null;
  routePolicy: RoutePolicy | null;
  authIsAuthenticated: boolean;
  isAdmin: boolean;
  isLoading: boolean;
  isSubmitting: boolean;
  onToggleConnection: () => void;
  onNavigate: (screen: Screen) => void;
}

export function HomeScreen({
  session,
  servers,
  activeServer,
  currentAssignment,
  routePolicy,
  authIsAuthenticated,
  isAdmin,
  isLoading,
  isSubmitting,
  onToggleConnection,
  onNavigate,
}: Props) {
  const isConnected = session?.status === "connected";

  return (
    <>
      <h1>Simple Dimple VPN</h1>
      <p className="hint">Открой. Нажми. Подключись.</p>

      <div className="hero">
        <button
          className="connectButton"
          onClick={onToggleConnection}
          disabled={isLoading || isSubmitting}
        >
          {isSubmitting ? "Обновляем..." : isConnected ? "Отключить" : "Подключить"}
        </button>

        <button
          className="secondaryButton"
          onClick={() => onNavigate("server")}
          disabled={isLoading || isSubmitting}
        >
          Сервер: {activeServer ? activeServer.label : "Не выбран"}
        </button>
      </div>

      <div className="homeMeta">
        <div>
          <span>Регион</span>
          <strong>{activeServer ? activeServer.region : "—"}</strong>
        </div>
        <div>
          <span>Последнее действие</span>
          <strong>
            {session ? new Date(session.updatedAt).toLocaleString("ru-RU") : "—"}
          </strong>
        </div>
        <div>
          <span>Выданный маршрут</span>
          <strong>
            {currentAssignment
              ? new Date(currentAssignment.assignedAt).toLocaleString("ru-RU")
              : "—"}
          </strong>
        </div>
        <div>
          <span>Policy</span>
          <strong>{formatAssignmentReason(routePolicy?.recommendedReason)}</strong>
        </div>
      </div>

      <div className="utilityNav" aria-label="Дополнительные разделы">
        <button
          className="utilityButton"
          onClick={() => onNavigate("server")}
          disabled={isLoading || isSubmitting}
        >
          Сервер
        </button>
        {isAdmin ? (
          <button
            className="utilityButton"
            onClick={() => onNavigate("admin")}
            disabled={isLoading || isSubmitting || !authIsAuthenticated}
          >
            Admin
          </button>
        ) : null}
        <button
          className="utilityButton"
          onClick={() => onNavigate("ops")}
          disabled={isLoading || isSubmitting || !authIsAuthenticated || !isAdmin}
        >
          Ops
        </button>
        <button
          className="utilityButton"
          onClick={() => onNavigate("account")}
          disabled={isLoading || isSubmitting}
        >
          Аккаунт
        </button>
      </div>
    </>
  );
}
