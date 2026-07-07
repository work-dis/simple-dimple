import { useState } from "react";

import { readJson } from "../lib";
import { buildRouteContext, submitProbeReport } from "../lib/network";
import type {
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
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function loadSession() {
    try {
      onClearError();
      const sessionQuery = new URLSearchParams(buildRouteContext());
      const data = await readJson<SessionResponse>(
        `/api/session?${sessionQuery.toString()}`,
      );

      setSession(data.session);
      setServers(data.servers);
      setCurrentAssignment(data.currentAssignment);
      setRouteHealth(data.routeHealth);
      setRoutePolicy(data.routePolicy);
    } catch (nextError) {
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

      if (data.session.status === "connected") {
        const nextServer = servers.find((server) => server.id === data.session.activeServerId);
        if (nextServer) void submitProbeReport(nextServer);
      }
    } catch (nextError) {
      onError(nextError instanceof Error ? nextError.message : "Unknown error");
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

      if (data.session.status === "connected") {
        const nextServer = servers.find((server) => server.id === serverId);
        if (nextServer) void submitProbeReport(nextServer);
      }
    } catch (nextError) {
      onError(nextError instanceof Error ? nextError.message : "Unknown error");
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
    isLoading,
    isSubmitting,
    loadSession,
    toggleConnection,
    changeServer,
  };
}
