import type { Session, ServerOption, EndpointAssignment, Screen } from "../types";

interface Props {
  session: Session | null;
  activeServer: ServerOption | undefined;
  currentAssignment: EndpointAssignment | null;
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
  currentAssignment,
  authIsAuthenticated,
  isAdmin,
  isLoading,
  isSubmitting,
  onToggleConnection,
  onNavigate,
}: Props) {
  const isConnected = session?.status === "connected";
  // Тихая метка "· авто" — только когда сервер подобрала система, а не сам
  // пользователь руками на экране Server.
  const isManualPick =
    currentAssignment?.assignmentReason === "manual_select" ||
    currentAssignment?.assignmentReason === "manual_override";

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
          {activeServer && !isManualPick ? " · авто" : ""}
        </button>
      </div>

      <p className="homeMeta">
        {activeServer ? activeServer.region : "—"}
        {" · "}
        {session ? new Date(session.updatedAt).toLocaleString("ru-RU") : "—"}
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
        {isAdmin ? (
          <button
            className="utilityButton"
            onClick={() => onNavigate("ops")}
            disabled={isLoading || isSubmitting || !authIsAuthenticated}
          >
            Ops
          </button>
        ) : null}
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
