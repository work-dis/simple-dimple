import { buildRoutePolicy, hasTelemetryContext, normalizeTelemetryContext } from "./route-policy.js";
import { createStateStore } from "./state-store.js";
import type { StateStore } from "./state-store.js";
import type { AuthSessionSummary, ResolveRoutesBody, TelemetryNetworkContext } from "./types.js";

export type ResolvedRouteDecision = {
  routeContext: TelemetryNetworkContext | undefined;
  servers: Awaited<ReturnType<StateStore["listServers"]>>;
  routeHealth: Awaited<ReturnType<StateStore["getHealthSnapshots"]>>;
  currentAssignment: Awaited<ReturnType<StateStore["getCurrentAssignment"]>>;
  lastKnownGoodRoute: Awaited<ReturnType<StateStore["getLastKnownGoodRoute"]>>;
  routePolicy: ReturnType<typeof buildRoutePolicy>;
};

export function createBackendRuntime(databaseUrl?: string) {
  const store = createStateStore(databaseUrl);

  async function loadAuthContext(sessionId?: string | null) {
    return store.readAuthContext(sessionId);
  }

  async function resolveRouteDecision(
    auth: AuthSessionSummary,
    input?: ResolveRoutesBody | TelemetryNetworkContext | null
  ): Promise<ResolvedRouteDecision> {
    const routeContext = normalizeTelemetryContext(input);
    // Порядок важен: persistedAssignment/lastKnownGoodRoute/manualEndpointId
    // нужны ДО listServers(), чтобы передать их как pinnedEndpointIds —
    // иначе bridge-модель (Decision 024) могла бы вырезать из списка уже
    // активное подключение, последний рабочий маршрут или то, что клиент
    // явно запросил.
    const persistedAssignment = await store.getCurrentAssignment(auth);
    const lastKnownGoodRoute = await store.getLastKnownGoodRoute(auth, routeContext);
    const manualEndpointId =
      input && "manualEndpointId" in input && typeof input.manualEndpointId === "string"
        ? input.manualEndpointId.trim()
        : "";
    const pinnedEndpointIds = [
      persistedAssignment?.endpointId ?? null,
      lastKnownGoodRoute?.endpointId ?? null,
      manualEndpointId || null
    ].filter((id): id is string => Boolean(id));
    const servers = await store.listServers(
      routeContext,
      auth.userId ? { subjectId: auth.userId, pinnedEndpointIds } : undefined
    );
    const routeHealth = await store.getHealthSnapshots(auth, routeContext);
    const manualServer = manualEndpointId ? servers.find((server) => server.id === manualEndpointId) : undefined;
    const currentAssignment = manualServer
      ? {
          id: "ephemeral-manual-resolve",
          endpointId: manualServer.id,
          deviceId: null,
          assignmentReason: "manual_select",
          assignedAt: new Date().toISOString(),
          expiresAt: null
        }
      : persistedAssignment;
    const routePolicy = buildRoutePolicy({
      servers,
      currentAssignmentEndpointId: currentAssignment?.endpointId ?? null,
      currentAssignmentReason: currentAssignment?.assignmentReason ?? null,
      lastKnownGoodEndpointId: lastKnownGoodRoute?.endpointId ?? null,
      hasNetworkRanking: hasTelemetryContext(routeContext),
      routeHealthSnapshots: routeHealth
    });

    return {
      routeContext,
      servers,
      routeHealth,
      currentAssignment,
      lastKnownGoodRoute,
      routePolicy
    };
  }

  return {
    store,
    loadAuthContext,
    resolveRouteDecision,
    async disconnect() {
      await store.disconnect();
    }
  };
}

export type BackendRuntime = ReturnType<typeof createBackendRuntime>;
