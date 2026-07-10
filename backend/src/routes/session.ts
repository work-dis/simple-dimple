import type { FastifyInstance } from "fastify";
import { normalizeTelemetryContext } from "../route-policy.js";
import type { BackendRuntime } from "../runtime.js";
import type { ResolveRoutesBody } from "../types.js";
import {
  getRequestAuthContext,
  isStatusCodeError,
  replyWithStatusCodeError,
  requireAuthenticatedAuthSession,
  requireAuthenticatedUserId,
  resolveRouteDecision
} from "./context.js";

export function registerSessionRoutes(app: FastifyInstance, runtime: BackendRuntime) {
  const store = runtime.store;

  app.get<{
    Querystring: {
      networkType?: "wifi" | "mobile" | "unknown";
      carrier?: string;
      asn?: string;
      countryCode?: string;
      region?: string;
    };
  }>("/api/session", async (request, reply) => {
    const context = await getRequestAuthContext(runtime, request);
    const userId = requireAuthenticatedUserId(context, reply);
    if (!userId) {
      return {
        error: "Authentication required"
      };
    }
    const parsedAsn =
      typeof request.query.asn === "string" && request.query.asn.trim().length > 0
        ? Number(request.query.asn)
        : undefined;
    const routeContext = normalizeTelemetryContext({
      networkType: request.query.networkType,
      carrier: request.query.carrier,
      asn: Number.isFinite(parsedAsn) ? parsedAsn : undefined,
      countryCode: request.query.countryCode,
      region: request.query.region
    });
    try {
      const [state, resolved] = await Promise.all([
        store.readConnectionState(userId),
        resolveRouteDecision(runtime, context.auth, routeContext)
      ]);

      return {
        session: state,
        servers: resolved.servers,
        currentAssignment: resolved.currentAssignment,
        routeHealth: resolved.routeHealth,
        routePolicy: resolved.routePolicy
      };
    } catch (error) {
      if (isStatusCodeError(error)) {
        return replyWithStatusCodeError(reply, error);
      }

      throw error;
    }
  });

  app.post<{ Body: ResolveRoutesBody }>("/api/routes/resolve", async (request, reply) => {
    const context = await getRequestAuthContext(runtime, request);
    if (!requireAuthenticatedAuthSession(context, reply)) {
      return {
        error: "Authentication required"
      };
    }
    const manualEndpointId = request.body?.manualEndpointId?.trim();
    const includeServers = request.body?.includeServers !== false;
    try {
      const resolved = await resolveRouteDecision(runtime, context.auth, {
        networkType: request.body?.networkType,
        carrier: request.body?.carrier,
        asn: request.body?.asn,
        countryCode: request.body?.countryCode,
        region: request.body?.region,
        manualEndpointId
      });

      if (manualEndpointId && !resolved.servers.some((server) => server.id === manualEndpointId)) {
        reply.code(404);
        return {
          error: "Manual endpoint not found"
        };
      }

      const effectiveEndpointId = manualEndpointId || resolved.routePolicy.recommendedEndpointId;
      const connectionConfig = await store.issueConnectionConfig(context.auth, effectiveEndpointId);

      return {
        resolvedAt: new Date().toISOString(),
        routePolicy: resolved.routePolicy,
        routeHealth: resolved.routeHealth,
        currentAssignment: resolved.currentAssignment,
        lastKnownGoodRoute: resolved.lastKnownGoodRoute,
        connectionConfig,
        servers: includeServers ? resolved.servers : undefined
      };
    } catch (error) {
      if (isStatusCodeError(error)) {
        return replyWithStatusCodeError(reply, error);
      }

      throw error;
    }
  });
}
