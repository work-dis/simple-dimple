import type { Session, ServerOption, RoutePolicy, Screen } from "../types";
import { formatAssignmentReason } from "../lib/formatters";

interface Props {
  session: Session | null;
  activeServer: ServerOption | undefined;
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
  activeServer,
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
      <p className="hint">
        {authIsAuthenticated
          ? "Открой. Нажми. Подключись."
          : "Войди в аккаунт, чтобы подключиться."}
      </p>

      <div className="hero">
        <button
          className="connectButton"
          onClick={onToggleConnection}
          disabled={isLoading || isSubmitting || !authIsAuthenticated}
        >
          {isSubmitting ? "..." : isConnected ? "Отключить" : "Подключить"}
        </button>

        <button
          className="secondaryButton"
          onClick={() => onNavigate("server")}
          disabled={isLoading || isSubmitting}
        >
          Сервер: {activeServer ? activeServer.label : "Не выбран"}
        </button>
      </div>

      <p className="homeMeta">
        {activeServer ? activeServer.region : "—"}
        {" · "}
        {session ? new Date(session.updatedAt).toLocaleString("ru-RU") : "—"}
        {routePolicy?.recommendedReason
          ? ` · ${formatAssignmentReason(routePolicy.recommendedReason)}`
          : ""}
      </p>

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
