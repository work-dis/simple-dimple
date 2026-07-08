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

  async function loadState() {
    return store.readState();
  }

  async function loadAuth(): Promise<AuthSessionSummary> {
    const state = await loadState();
    return state.auth;
  }

  async function loadAuthContext(sessionId?: string | null) {
    return store.readAuthContext(sessionId);
  }

  async function resolveRouteDecision(
    auth: AuthSessionSummary,
    input?: ResolveRoutesBody | TelemetryNetworkContext | null
  ): Promise<ResolvedRouteDecision> {
    const routeContext = normalizeTelemetryContext(input);
    const servers = await store.listServers(routeContext);
    const routeHealth = await store.getHealthSnapshots(auth, routeContext);
    const persistedAssignment = await store.getCurrentAssignment(auth);
    const lastKnownGoodRoute = await store.getLastKnownGoodRoute(auth, routeContext);
    const manualEndpointId =
      input && "manualEndpointId" in input && typeof input.manualEndpointId === "string"
        ? input.manualEndpointId.trim()
        : "";
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

  async function resolveRouteDecisionForActiveAuth(input?: ResolveRoutesBody | TelemetryNetworkContext | null) {
    const auth = await loadAuth();
    return resolveRouteDecision(auth, input);
  }

  return {
    store,
    loadState,
    loadAuth,
    loadAuthContext,
    resolveRouteDecision,
    resolveRouteDecisionForActiveAuth,
    async disconnect() {
      await store.disconnect();
    }
  };
}

export type BackendRuntime = ReturnType<typeof createBackendRuntime>;
