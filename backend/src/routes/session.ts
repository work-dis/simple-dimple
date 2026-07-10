import type { FastifyInstance, FastifyReply } from "fastify";
import { checkEndpointsReachability } from "../endpoint-healthcheck.js";
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

type SessionQuery = {
  networkType?: "wifi" | "mobile" | "unknown";
  carrier?: string;
  asn?: string;
  countryCode?: string;
  region?: string;
};

// On-demand latency probe timeout — short enough that opening the Server
// screen doesn't hang on an unreachable endpoint, unlike the background
// health-check worker's more generous default.
const onDemandLatencyCheckTimeoutMs = 3_000;

export function registerSessionRoutes(app: FastifyInstance, runtime: BackendRuntime) {
  const store = runtime.store;

  function buildRouteContext(query: SessionQuery) {
    const parsedAsn =
      typeof query.asn === "string" && query.asn.trim().length > 0 ? Number(query.asn) : undefined;
    return normalizeTelemetryContext({
      networkType: query.networkType,
      carrier: query.carrier,
      asn: Number.isFinite(parsedAsn) ? parsedAsn : undefined,
      countryCode: query.countryCode,
      region: query.region
    });
  }

  async function respondWithSession(
    request: { headers: Record<string, string | string[] | undefined> },
    reply: Pick<FastifyReply, "code">,
    query: SessionQuery
  ) {
    const context = await getRequestAuthContext(runtime, request);
    const userId = requireAuthenticatedUserId(context, reply);
    if (!userId) {
      return {
        error: "Authentication required"
      };
    }
    const routeContext = buildRouteContext(query);
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
  }

  app.get<{ Querystring: SessionQuery }>("/api/session", async (request, reply) =>
    respondWithSession(request, reply, request.query)
  );

  // Опрашивает пинг всех checkable-эндпоинтов синхронно (не ждёт следующего
  // тика фонового health-check воркера) — вызывается при открытии экрана
  // "Сервер", чтобы список не показывал число из последнего фонового прогона
  // многоминутной давности.
  app.post<{ Querystring: SessionQuery }>("/api/session/refresh-latency", async (request, reply) => {
    const targets = await store.listCheckableEndpoints();
    const results = await checkEndpointsReachability(targets, onDemandLatencyCheckTimeoutMs);
    await Promise.all(results.map((result) => store.applyHealthCheckResult(result)));

    return respondWithSession(request, reply, request.query);
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
