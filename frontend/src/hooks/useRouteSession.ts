import { useState } from "react";

import { HttpError, readJson } from "../lib";
import { buildRouteContext, submitProbeReport } from "../lib/network";
import type {
  ConnectionConfigSummary,
  EndpointAssignment,
  RouteHealthSnapshot,
  RoutePolicy,
  ServerOption,
  Session,
  SessionResponse,
} from "../types";

interface UseRouteSessionOptions {
  onClearError: () => void;
  onError: (message: string) => void;
}

export function useRouteSession({
  onClearError,
  onError,
}: UseRouteSessionOptions) {
  const [session, setSession] = useState<Session | null>(null);
  const [servers, setServers] = useState<ServerOption[]>([]);
  const [currentAssignment, setCurrentAssignment] =
    useState<EndpointAssignment | null>(null);
  const [routeHealth, setRouteHealth] = useState<RouteHealthSnapshot[]>([]);
  const [routePolicy, setRoutePolicy] = useState<RoutePolicy | null>(null);
  const [connectionConfig, setConnectionConfig] =
    useState<ConnectionConfigSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Data-plane эндпоинты (/api/session, /api/connect, /api/server) теперь требуют
  // аутентификацию, поэтому signed-out состояние — это не ошибка, а пустой сброс.
  function resetSession() {
    setSession(null);
    setServers([]);
    setCurrentAssignment(null);
    setRouteHealth([]);
    setRoutePolicy(null);
    setConnectionConfig(null);
    setIsLoading(false);
  }

  async function loadSession() {
    setIsLoading(true);
    try {
      onClearError();
      const sessionQuery = new URLSearchParams(
        buildRouteContext() as unknown as Record<string, string>,
      );
      const data = await readJson<SessionResponse>(
        `/api/session?${sessionQuery.toString()}`,
      );

      setSession(data.session);
      setServers(data.servers ?? []);
      setCurrentAssignment(data.currentAssignment);
      setRouteHealth(data.routeHealth);
      setRoutePolicy(data.routePolicy);
    } catch (nextError) {
      if (nextError instanceof HttpError && nextError.status === 401) {
        resetSession();
        return;
      }
      onError(nextError instanceof Error ? nextError.message : "Unknown error");
    } finally {
      setIsLoading(false);
    }
  }

  async function toggleConnection() {
    setIsSubmitting(true);
    try {
      onClearError();
      const data = await readJson<SessionResponse>("/api/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildRouteContext()),
      });

      setSession(data.session);
      setCurrentAssignment(data.currentAssignment);
      setRouteHealth(data.routeHealth);
      setRoutePolicy(data.routePolicy);
      setConnectionConfig(data.connectionConfig ?? null);

      if (data.session.status === "connected") {
        const nextServer = servers.find((server) => server.id === data.session.activeServerId);
        if (nextServer) void submitProbeReport(nextServer);
      }
    } catch (nextError) {
      onError(
        nextError instanceof HttpError && nextError.status === 401
          ? "Нужно войти в аккаунт, чтобы подключиться"
          : nextError instanceof Error
            ? nextError.message
            : "Unknown error",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function changeServer(serverId: string) {
    setIsSubmitting(true);
    try {
      onClearError();
      const data = await readJson<SessionResponse>("/api/server", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serverId, ...buildRouteContext() }),
      });

      setSession(data.session);
      setCurrentAssignment(data.currentAssignment);
      setRouteHealth(data.routeHealth);
      setRoutePolicy(data.routePolicy);
      setConnectionConfig(data.connectionConfig ?? null);

      if (data.session.status === "connected") {
        const nextServer = servers.find((server) => server.id === serverId);
        if (nextServer) void submitProbeReport(nextServer);
      }
    } catch (nextError) {
      onError(
        nextError instanceof HttpError && nextError.status === 401
          ? "Нужно войти в аккаунт, чтобы сменить сервер"
          : nextError instanceof Error
            ? nextError.message
            : "Unknown error",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  const activeServer = servers.find((server) => server.id === session?.activeServerId);

  return {
    session,
    servers,
    activeServer,
    currentAssignment,
    routeHealth,
    routePolicy,
    connectionConfig,
    isLoading,
    isSubmitting,
    loadSession,
    resetSession,
    toggleConnection,
    changeServer,
  };
}
