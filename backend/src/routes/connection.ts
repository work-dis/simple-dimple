import type { FastifyInstance } from "fastify";
import { buildRoutePolicy, hasTelemetryContext } from "../route-policy.js";
import type { BackendRuntime } from "../runtime.js";
import type { TelemetryNetworkContext } from "../types.js";
import {
  getRequestAuthContext,
  isStatusCodeError,
  replyWithStatusCodeError,
  requireAuthenticatedUserId,
  resolveRouteDecision
} from "./context.js";
import type { StateLock } from "./state-lock.js";

// Шаг 3 (PRIORITY_PLAN.md) — client-side auto-fallback вызывает /api/server сам,
// когда primary-кандидат не подключился. Такой pick не должен записываться как
// "manual_select"/"manual_override" — эти два reason'а зарезервированы за настоящим
// пользовательским выбором и "прикалывают" маршрут в route-policy.ts (manualOverride).
// Разрешаем клиенту передать только уже известные policy-engine reason'ы из shortlist.
const autoFallbackAssignmentReasons = new Set([
  "last_known_good",
  "network_ranking_primary",
  "baseline_pool_priority",
  "route_health_adjusted_primary",
  "transport_diagnostic_fallback",
  "provider_diversity_fallback",
  "asn_diversity_fallback",
  "emergency_fallback"
]);

export function registerConnectionRoutes(app: FastifyInstance, runtime: BackendRuntime, withStateLock: StateLock) {
  const store = runtime.store;

  app.post<{ Body: TelemetryNetworkContext }>("/api/connect", async (request, reply) => {
    const context = await getRequestAuthContext(runtime, request);
    const userId = requireAuthenticatedUserId(context, reply);
    if (!userId) {
      return {
        error: "Authentication required"
      };
    }

    return withStateLock(userId, async () => {
      try {
        const state = await store.readConnectionState(userId);
        state.status = state.status === "connected" ? "disconnected" : "connected";
        state.connectCount += 1;
        const resolved = await resolveRouteDecision(runtime, context.auth, request.body);
        const selectedEndpointId = resolved.routePolicy.recommendedEndpointId ?? state.activeServerId;

        if (state.status === "connected") {
          state.activeServerId = selectedEndpointId;
        }

        state.updatedAt = new Date().toISOString();
        await store.writeSession(userId, state);

        const currentAssignment =
          state.status === "connected"
            ? await store.assignEndpoint(context.auth, {
                endpointId: selectedEndpointId,
                assignmentReason: resolved.routePolicy.recommendedReason ?? "connect_request",
                expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
              })
            : resolved.currentAssignment;
        const nextLastKnownGoodRoute =
          state.status === "connected"
            ? await store.recordLastKnownGoodRoute(context.auth, {
                endpointId: selectedEndpointId,
                context: resolved.routeContext,
                sourceAssignmentReason: currentAssignment?.assignmentReason ?? resolved.routePolicy.recommendedReason ?? null,
                expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
              })
            : resolved.lastKnownGoodRoute;
        const nextRoutePolicy = buildRoutePolicy({
          servers: resolved.servers,
          currentAssignmentEndpointId: currentAssignment?.endpointId ?? resolved.currentAssignment?.endpointId ?? null,
          currentAssignmentReason: currentAssignment?.assignmentReason ?? resolved.currentAssignment?.assignmentReason ?? null,
          lastKnownGoodEndpointId: nextLastKnownGoodRoute?.endpointId ?? resolved.lastKnownGoodRoute?.endpointId ?? null,
          hasNetworkRanking: hasTelemetryContext(resolved.routeContext),
          routeHealthSnapshots: resolved.routeHealth
        });
        const connectionConfig =
          state.status === "connected"
            ? await store.issueConnectionConfig(context.auth, selectedEndpointId)
            : null;

        return {
          session: state,
          currentAssignment,
          routeHealth: resolved.routeHealth,
          routePolicy: nextRoutePolicy,
          connectionConfig
        };
      } catch (error) {
        if (isStatusCodeError(error)) {
          return replyWithStatusCodeError(reply, error);
        }

        throw error;
      }
    });
  });

  app.post<{ Body: { serverId?: string; assignmentReason?: string } & TelemetryNetworkContext }>(
    "/api/server",
    async (request, reply) => {
      const context = await getRequestAuthContext(runtime, request);
      const userId = requireAuthenticatedUserId(context, reply);
      if (!userId) {
        return {
          error: "Authentication required"
        };
      }

      return withStateLock(userId, async () => {
        try {
          const state = await store.readConnectionState(userId);
          const { serverId } = request.body;
          const requestedAssignmentReason = request.body?.assignmentReason?.trim();
          if (requestedAssignmentReason && !autoFallbackAssignmentReasons.has(requestedAssignmentReason)) {
            reply.code(400);
            return {
              error: "assignmentReason must be a known automatic fallback reason"
            };
          }
          // Явный reason из auto-fallback executor'а (Шаг 3) либо дефолт "manual_select"
          // для существующего flow ручного выбора на экране Server — поведение по
          // умолчанию не меняется, если клиент ничего не передаёт.
          const assignmentReason = requestedAssignmentReason || "manual_select";
          const resolved = await resolveRouteDecision(runtime, context.auth, {
            networkType: request.body?.networkType,
            carrier: request.body?.carrier,
            asn: request.body?.asn,
            countryCode: request.body?.countryCode,
            region: request.body?.region
          });
          const nextServer = resolved.servers.find((item) => item.id === serverId);

          if (!nextServer) {
            reply.code(404);
            return {
              error: "Server not found"
            };
          }

          state.activeServerId = nextServer.id;
          state.updatedAt = new Date().toISOString();
          await store.writeSession(userId, state);
          const currentAssignment = await store.assignEndpoint(context.auth, {
            endpointId: nextServer.id,
            assignmentReason,
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
          });
          const routePolicy = buildRoutePolicy({
            servers: resolved.servers,
            currentAssignmentEndpointId: currentAssignment?.endpointId ?? nextServer.id,
            currentAssignmentReason: currentAssignment?.assignmentReason ?? assignmentReason,
            lastKnownGoodEndpointId: resolved.lastKnownGoodRoute?.endpointId ?? null,
            hasNetworkRanking: hasTelemetryContext(resolved.routeContext),
            routeHealthSnapshots: resolved.routeHealth
          });
          const connectionConfig =
            state.status === "connected"
              ? await store.issueConnectionConfig(context.auth, nextServer.id)
              : null;

          return {
            session: state,
            activeServer: nextServer,
            currentAssignment,
            routeHealth: resolved.routeHealth,
            routePolicy,
            connectionConfig
          };
        } catch (error) {
          if (isStatusCodeError(error)) {
            return replyWithStatusCodeError(reply, error);
          }

          throw error;
        }
      });
    }
  );
}
