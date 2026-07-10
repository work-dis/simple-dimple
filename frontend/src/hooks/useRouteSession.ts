import { useState } from "react";

import {
  HttpError,
  connectNativeTunnel,
  connectWithFallback,
  disconnectNativeTunnel,
  getStoredAuthSessionId,
  isNativeTunnelAvailable,
  readJson,
  resolveApiUrl,
} from "../lib";
import { buildRouteContext, submitProbeReport } from "../lib/network";
import { enqueueTelemetryReport } from "../lib/telemetryQueue";
import type {
  ConnectionConfigSummary,
  EndpointAssignment,
  RouteHealthSnapshot,
  RoutePolicy,
  RoutePolicyCandidate,
  ServerOption,
  Session,
  SessionResponse,
  TelemetryFailureReason,
} from "../types";

interface UseRouteSessionOptions {
  onClearError: () => void;
  onError: (message: string) => void;
}

// Шаг 3 (PRIORITY_PLAN.md) — достаёт connectionConfig для конкретного
// кандидата из shortlist через чистый resolve-контракт (не трогает
// session.status), чтобы auto-fallback executor мог пробовать кандидатов
// один за другим без побочных эффектов на каждой попытке.
async function fetchCandidateConnectionConfig(endpointId: string): Promise<ConnectionConfigSummary | null> {
  try {
    const query = buildRouteContext();
    const data = await readJson<{ connectionConfig: ConnectionConfigSummary | null }>("/api/routes/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ manualEndpointId: endpointId, includeServers: false, ...query }),
    });
    return data.connectionConfig ?? null;
  } catch {
    return null;
  }
}

// Шлёт feedback о провале конкретного кандидата раньше перехода к следующему —
// best-effort, той же философии, что и submitProbeReport в lib/network.ts.
// Если отправка не удалась, отчёт кэшируется через telemetryQueue и досылается
// позже (Этап 8, ROADMAP.md), а не теряется молча.
async function reportCandidateFailure(candidate: RoutePolicyCandidate, failureReason: TelemetryFailureReason) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const sessionId = getStoredAuthSessionId();
  if (sessionId) {
    headers["x-auth-session-id"] = sessionId;
  }
  const url = resolveApiUrl("/api/routes/feedback");
  const body = JSON.stringify({
    endpointId: candidate.endpointId,
    transportProfile: candidate.transportProfile,
    result: "failed",
    failureReason,
    occurredAt: new Date().toISOString(),
    source: "connect",
    ...buildRouteContext(),
  });

  try {
    const response = await fetch(url, { method: "POST", headers, body });
    if (!response.ok) {
      enqueueTelemetryReport(url, body, headers);
    }
  } catch {
    enqueueTelemetryReport(url, body, headers);
  }
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

  // Best-effort native tunnel side effect (Этап 2b, PRIORITY_PLAN.md). Backend
  // session.status stays the source of truth (Decision 021) — in the plain PWA
  // this is always a no-op (isNativeTunnelAvailable() is false), so it never
  // affects the existing browser-only connect/disconnect flow.
  async function applyNativeTunnel(status: Session["status"], config: ConnectionConfigSummary | null) {
    if (!isNativeTunnelAvailable()) {
      return;
    }

    const result =
      status === "connected" && config ? await connectNativeTunnel(config) : await disconnectNativeTunnel();

    if (!result.ok) {
      onError(`Native VPN tunnel: ${result.error}`);
    }
  }

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

      let finalActiveServerId = data.session.activeServerId;

      if (data.session.status === "connected" && data.connectionConfig && isNativeTunnelAvailable()) {
        // Шаг 3 (PRIORITY_PLAN.md) — recommended-кандидат может реально не
        // подняться на устройстве; проходим по routePolicy.shortlist сами
        // вместо того, чтобы требовать ручного похода на экран Server.
        const outcome = await connectWithFallback(data.routePolicy.shortlist, data.connectionConfig, {
          attemptTunnel: connectNativeTunnel,
          fetchCandidateConfig: fetchCandidateConnectionConfig,
          reportFailure: reportCandidateFailure,
        });

        if (!outcome.ok) {
          onError("Не удалось подключиться ни к одному серверу из списка");
        } else if (outcome.endpointId && outcome.candidate && outcome.endpointId !== data.session.activeServerId) {
          // Fallback выбрал не recommended-кандидата — подтверждаем выбор
          // официально с честным (не "manual_select") assignmentReason.
          const switched = await readJson<SessionResponse>("/api/server", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              serverId: outcome.endpointId,
              assignmentReason: outcome.candidate.assignmentReason,
              ...buildRouteContext(),
            }),
          });
          setSession(switched.session);
          setCurrentAssignment(switched.currentAssignment);
          setRouteHealth(switched.routeHealth);
          setRoutePolicy(switched.routePolicy);
          setConnectionConfig(switched.connectionConfig ?? null);
          finalActiveServerId = switched.session.activeServerId;
        }
      } else {
        await applyNativeTunnel(data.session.status, data.connectionConfig ?? null);
      }

      if (data.session.status === "connected") {
        const nextServer = servers.find((server) => server.id === finalActiveServerId);
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
        // Переключение сервера во время активного подключения: поднимаем туннель
        // заново с конфигом нового endpoint-а вместо того, чтобы оставить
        // нативную сторону с устаревшим VLESS-конфигом.
        await applyNativeTunnel(data.session.status, data.connectionConfig ?? null);
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
