import "dotenv/config";

import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import Fastify from "fastify";
import { buildRoutePolicy, hasTelemetryContext, normalizeTelemetryContext } from "./route-policy.js";
import { normalizeRouteReprobeCandidateLimit } from "./route-reprobe.js";
import { createBackendRuntime } from "./runtime.js";
import { trimmedContactLooksLikeEmail } from "./store/utils.js";
import type {
  LoginWithPasswordBody,
  SnoozeOpsAlertBody,
  RecordRouteFeedbackInput,
  RegisterWithPasswordBody,
  ResolveRoutesBody,
  RouteFeedbackBody,
  RouteFeedbackSource,
  RouteReprobeJobBody,
  RequestAuthChallengeBody,
  TelemetryFailureReason,
  TelemetryNetworkContext,
  TelemetryProbeResult,
  TelemetryProbeBody,
  UpdateAccountProfileBody,
  UpdateUserAdminBody,
  VerifyAuthChallengeBody
} from "./types.js";

const telemetryProbeResults = new Set<TelemetryProbeResult>(["connected", "unstable", "failed"]);
const telemetryFailureReasons = new Set<TelemetryFailureReason>([
  "timeout",
  "handshake_failed",
  "connect_refused",
  "dns_blocked",
  "captive_portal",
  "packet_loss_suspected",
  "tls_error",
  "unknown"
]);
const routeFeedbackSources = new Set<RouteFeedbackSource>(["resolve", "connect", "runtime_reprobe", "manual_report"]);

const runtime = createBackendRuntime(process.env.DATABASE_URL);
const store = runtime.store;
const persistedState = await runtime.loadState();
const state = persistedState.session;

// ── state mutation serialization ──────────────────────────────────────────────
// Сериализует конкурентные мутации глобального state (module-level object).
// Два одновременных POST /api/connect не могут прочитать stale status.
let _stateQueue = Promise.resolve<unknown>(void 0);
function withStateLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = _stateQueue.then(fn, fn);
  _stateQueue = next.then(() => void 0, () => void 0);
  return next;
}

const app = Fastify({
  logger: true
});

// CORS origin берётся из CORS_ALLOWED_ORIGINS (список через запятую). Если переменная
// не задана, оставляем reflect-all (origin: true) для локального dev — прод обязан
// задать явный allowlist. См. DECISIONS.md, Decision 022.
const corsAllowedOrigins = (process.env.CORS_ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter((origin) => origin.length > 0);

await app.register(cors, {
  origin: corsAllowedOrigins.length > 0 ? corsAllowedOrigins : true
});

await app.register(rateLimit, {
  max: 100,
  timeWindow: "1 minute"
});

app.addHook("onClose", async () => {
  await runtime.disconnect();
});

type RequestAuthContext = Awaited<ReturnType<typeof runtime.loadAuthContext>>;

async function getRequestAuthContext(request: { headers: Record<string, string | string[] | undefined> }) {
  const rawSessionId = request.headers["x-auth-session-id"];
  const sessionId = Array.isArray(rawSessionId) ? rawSessionId[0] : rawSessionId;
  return runtime.loadAuthContext(sessionId);
}

function requireAuthenticatedAuthSession(context: RequestAuthContext, reply: { code: (statusCode: number) => void }) {
  if (context.auth.isAuthenticated) {
    return true;
  }

  reply.code(401);
  return false;
}

function requireAdminAuthSession(context: RequestAuthContext, reply: { code: (statusCode: number) => void }) {
  if (!context.auth.isAuthenticated) {
    reply.code(401);
    return false;
  }

  if (context.account.user.isAdmin) {
    return true;
  }

  reply.code(403);
  return false;
}

function isStatusCodeError(error: unknown): error is Error & { statusCode: number } {
  return error instanceof Error && "statusCode" in error && typeof error.statusCode === "number";
}

function replyWithStatusCodeError(reply: { code: (statusCode: number) => void }, error: Error & { statusCode: number }) {
  reply.code(error.statusCode);
  return {
    error: error.message
  };
}

async function resolveRouteDecision(
  auth: RequestAuthContext["auth"],
  input?: ResolveRoutesBody | TelemetryNetworkContext | null
) {
  return runtime.resolveRouteDecision(auth, input);
}

app.get("/health", async () => {
  return {
    ok: true,
    service: "backend",
    checkedAt: new Date().toISOString()
  };
});

app.get<{
  Querystring: {
    networkType?: "wifi" | "mobile" | "unknown";
    carrier?: string;
    asn?: string;
    countryCode?: string;
    region?: string;
  };
}>("/api/session", async (request, reply) => {
  const context = await getRequestAuthContext(request);
  if (!requireAuthenticatedAuthSession(context, reply)) {
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
    const resolved = await resolveRouteDecision(context.auth, routeContext);

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
  const context = await getRequestAuthContext(request);
  if (!requireAuthenticatedAuthSession(context, reply)) {
    return {
      error: "Authentication required"
    };
  }
  const manualEndpointId = request.body?.manualEndpointId?.trim();
  const includeServers = request.body?.includeServers !== false;
  try {
    const resolved = await resolveRouteDecision(context.auth, {
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

app.get("/api/auth/session", async (request) => {
  const context = await getRequestAuthContext(request);
  return {
    auth: context.auth
  };
});

app.post<{ Body: LoginWithPasswordBody }>("/api/auth/login", async (request, reply) => {
  const login = request.body?.login?.trim();
  const password = request.body?.password;

  if (!login || !password) {
    reply.code(400);
    return {
      error: "Login and password are required"
    };
  }

  try {
    const result = await store.loginWithPassword({
      login,
      password
    });
    return {
      auth: result.auth,
      account: result.account
    };
  } catch (error) {
    if (error instanceof Error && "statusCode" in error && typeof error.statusCode === "number") {
      reply.code(error.statusCode);
      return {
        error: error.message
      };
    }

    throw error;
  }

});

app.post<{ Body: RegisterWithPasswordBody }>("/api/auth/register", async (request, reply) => {
  const login = request.body?.login?.trim();
  const password = request.body?.password;

  if (!login || !password) {
    reply.code(400);
    return {
      error: "Login and password are required"
    };
  }

  if (login.length < 3) {
    reply.code(400);
    return {
      error: "Login must contain at least 3 characters"
    };
  }

  if (password.length < 6) {
    reply.code(400);
    return {
      error: "Password must contain at least 6 characters"
    };
  }

  const displayName = request.body?.displayName?.trim() || login;

  try {
    const result = await store.registerWithPassword({
      login,
      password,
      displayName
    });
    return {
      auth: result.auth,
      account: result.account
    };
  } catch (error) {
    if (error instanceof Error && "statusCode" in error && typeof error.statusCode === "number") {
      reply.code(error.statusCode);
      return {
        error: error.message
      };
    }

    throw error;
  }

});

app.post<{ Body: RequestAuthChallengeBody }>("/api/auth/challenge", async (request, reply) => {
  const provider = request.body?.provider;
  const target = request.body?.target?.trim();

  if ((provider !== "email" && provider !== "telegram") || !target) {
    reply.code(400);
    return {
      error: "Verification provider and target are required"
    };
  }

  try {
    const challenge = await store.requestAuthChallenge({
      provider,
      target
    });

    return {
      challenge
    };
  } catch (error) {
    if (error instanceof Error && "statusCode" in error && typeof error.statusCode === "number") {
      reply.code(error.statusCode);
      return {
        error: error.message
      };
    }

    throw error;
  }
});

app.post<{ Body: VerifyAuthChallengeBody }>("/api/auth/verify", async (request, reply) => {
  const challengeId = request.body?.challengeId?.trim();
  const code = request.body?.code?.trim();
  const displayName = request.body?.displayName?.trim() ?? "";

  if (!challengeId || !code) {
    reply.code(400);
    return {
      error: "Challenge id and code are required"
    };
  }

  try {
    const result = await store.verifyAuthChallenge({
      challengeId,
      code,
      displayName
    });
    return {
      auth: result.auth,
      account: result.account
    };
  } catch (error) {
    if (error instanceof Error && "statusCode" in error && typeof error.statusCode === "number") {
      reply.code(error.statusCode);
      return {
        error: error.message
      };
    }

    throw error;
  }

});

app.post("/api/auth/logout", async (request) => {
  const context = await getRequestAuthContext(request);
  const rawSessionId = request.headers["x-auth-session-id"];
  const sessionId = Array.isArray(rawSessionId) ? rawSessionId[0] : rawSessionId;
  const auth = await store.logout(sessionId ?? context.auth.id);

  return {
    auth
  };
});

app.get("/api/account", async (request, reply) => {
  const context = await getRequestAuthContext(request);
  if (!context.auth.isAuthenticated) {
    reply.code(401);
    return {
      error: "Authentication required"
    };
  }

  return {
    account: context.account
  };
});

app.post<{ Body: TelemetryProbeBody }>("/api/telemetry/probe", async (request, reply) => {
  const context = await getRequestAuthContext(request);
  if (!requireAuthenticatedAuthSession(context, reply)) {
    return {
      error: "Authentication required"
    };
  }
  const endpointId = request.body?.endpointId?.trim();
  const transportProfile = request.body?.transportProfile?.trim();
  const result = request.body?.result?.trim();
  const failureReason = request.body?.failureReason?.trim();
  const testedAt = request.body?.testedAt?.trim();

  if (!endpointId || !transportProfile || !result || !testedAt) {
    reply.code(400);
    return {
      error: "endpointId, transportProfile, result and testedAt are required"
    };
  }

  if (Number.isNaN(Date.parse(testedAt))) {
    reply.code(400);
    return {
      error: "testedAt must be a valid ISO date"
    };
  }

  if (!telemetryProbeResults.has(result as TelemetryProbeResult)) {
    reply.code(400);
    return {
      error: "result must be connected, unstable or failed"
    };
  }
  if (failureReason && !telemetryFailureReasons.has(failureReason as TelemetryFailureReason)) {
    reply.code(400);
    return {
      error: "failureReason must be a known telemetry failure reason"
    };
  }
  if (result === "failed" && !failureReason) {
    reply.code(400);
    return {
      error: "failureReason is required when result is failed"
    };
  }
  if (result === "connected" && failureReason) {
    reply.code(400);
    return {
      error: "failureReason must be omitted when result is connected"
    };
  }

  try {
    await store.submitProbeReport(context.auth, {
      results: [{
        endpointId,
        transportProfile,
        result: result as TelemetryProbeResult,
        failureReason: failureReason as TelemetryFailureReason | undefined,
        latencyMs: request.body?.latencyMs,
        bytesSent: request.body?.bytesSent,
        bytesReceived: request.body?.bytesReceived,
        appVersion: request.body?.appVersion,
        testedAt
      }],
      context: {
        networkType: request.body?.networkType,
        carrier: request.body?.carrier,
        asn: request.body?.asn,
        countryCode: request.body?.countryCode,
        region: request.body?.region
      }
    });
  } catch (error) {
    if (error instanceof Error && "statusCode" in error && typeof error.statusCode === "number") {
      reply.code(error.statusCode);
      return {
        error: error.message
      };
    }

    throw error;
  }

  reply.code(202);
  return {
    accepted: true
  };
});

app.post<{ Body: RouteFeedbackBody }>("/api/routes/feedback", async (request, reply) => {
  const context = await getRequestAuthContext(request);
  if (!requireAuthenticatedAuthSession(context, reply)) {
    return {
      error: "Authentication required"
    };
  }
  const endpointId = request.body?.endpointId?.trim();
  const transportProfile = request.body?.transportProfile?.trim();
  const result = request.body?.result?.trim();
  const failureReason = request.body?.failureReason?.trim();
  const occurredAt = request.body?.occurredAt?.trim();
  const source = request.body?.source?.trim();

  if (!endpointId || !transportProfile || !result || !occurredAt) {
    reply.code(400);
    return {
      error: "endpointId, transportProfile, result and occurredAt are required"
    };
  }

  if (Number.isNaN(Date.parse(occurredAt))) {
    reply.code(400);
    return {
      error: "occurredAt must be a valid ISO date"
    };
  }

  if (!telemetryProbeResults.has(result as TelemetryProbeResult)) {
    reply.code(400);
    return {
      error: "result must be connected, unstable or failed"
    };
  }
  if (failureReason && !telemetryFailureReasons.has(failureReason as TelemetryFailureReason)) {
    reply.code(400);
    return {
      error: "failureReason must be a known telemetry failure reason"
    };
  }
  if (result === "failed" && !failureReason) {
    reply.code(400);
    return {
      error: "failureReason is required when result is failed"
    };
  }
  if (result === "connected" && failureReason) {
    reply.code(400);
    return {
      error: "failureReason must be omitted when result is connected"
    };
  }
  if (source && !routeFeedbackSources.has(source as RouteFeedbackSource)) {
    reply.code(400);
    return {
      error: "source must be resolve, connect, runtime_reprobe or manual_report"
    };
  }

  try {
    const feedbackInput: RecordRouteFeedbackInput = {
      endpointId,
      transportProfile,
      result: result as RecordRouteFeedbackInput["result"],
      failureReason: failureReason as TelemetryFailureReason | undefined,
      occurredAt,
      latencyMs: request.body?.latencyMs,
      appVersion: request.body?.appVersion,
      source: (source as RouteFeedbackSource | undefined) ?? "manual_report",
      note: request.body?.note,
      networkType: request.body?.networkType,
      carrier: request.body?.carrier,
      asn: request.body?.asn,
      countryCode: request.body?.countryCode,
      region: request.body?.region
    };

    await store.recordRouteFeedback(context.auth, feedbackInput);
  } catch (error) {
    if (error instanceof Error && "statusCode" in error && typeof error.statusCode === "number") {
      reply.code(error.statusCode);
      return {
        error: error.message
      };
    }

    throw error;
  }

  reply.code(202);
  return {
    accepted: true
  };
});

app.get("/api/ops/route-reprobe-jobs", async (request, reply) => {
  const context = await getRequestAuthContext(request);
  if (!requireAdminAuthSession(context, reply)) {
    return {
      error: context.auth.isAuthenticated ? "Admin access required" : "Authentication required"
    };
  }

  return {
    jobs: await store.listRouteReprobeJobs()
  };
});

app.post<{ Body: RouteReprobeJobBody }>("/api/ops/route-reprobe-jobs", async (request, reply) => {
  const context = await getRequestAuthContext(request);
  if (!requireAdminAuthSession(context, reply)) {
    return {
      error: context.auth.isAuthenticated ? "Admin access required" : "Authentication required"
    };
  }

  const candidateLimit = request.body?.candidateLimit;
  const maxAttempts = request.body?.maxAttempts;

  if (candidateLimit !== undefined && (!Number.isFinite(candidateLimit) || candidateLimit < 1 || candidateLimit > 5)) {
    reply.code(400);
    return {
      error: "candidateLimit must be between 1 and 5"
    };
  }

  if (maxAttempts !== undefined && (!Number.isFinite(maxAttempts) || maxAttempts < 1 || maxAttempts > 10)) {
    reply.code(400);
    return {
      error: "maxAttempts must be between 1 and 10"
    };
  }

  for (const result of request.body?.results ?? []) {
    if (!result.endpointId || !result.transportProfile || !result.result) {
      reply.code(400);
      return {
        error: "Each reprobe result must include endpointId, transportProfile and result"
      };
    }

    if (!telemetryProbeResults.has(result.result as TelemetryProbeResult)) {
      reply.code(400);
      return {
        error: "Reprobe result must be connected, unstable or failed"
      };
    }

    if (result.failureReason && !telemetryFailureReasons.has(result.failureReason as TelemetryFailureReason)) {
      reply.code(400);
      return {
        error: "Reprobe failureReason must be a known telemetry failure reason"
      };
    }

    if (result.result === "failed" && !result.failureReason) {
      reply.code(400);
      return {
        error: "failureReason is required when reprobe result is failed"
      };
    }
  }

  const job = await store.enqueueRouteReprobeJob({
    networkType: request.body?.networkType,
    carrier: request.body?.carrier,
    asn: request.body?.asn,
    countryCode: request.body?.countryCode,
    region: request.body?.region,
    candidateLimit: normalizeRouteReprobeCandidateLimit(candidateLimit),
    maxAttempts,
    note: request.body?.note,
    appVersion: request.body?.appVersion,
    results: request.body?.results
  });

  reply.code(202);
  return {
    job
  };
});

app.get<{
  Querystring: {
    windowHours?: string;
    recentLimit?: string;
    summaryLimit?: string;
  };
}>("/api/ops/route-decisions", async (request, reply) => {
  const context = await getRequestAuthContext(request);
  if (!requireAdminAuthSession(context, reply)) {
    return {
      error: context.auth.isAuthenticated ? "Admin access required" : "Authentication required"
    };
  }

  const parsedWindowHours: number | undefined =
    typeof request.query.windowHours === "string" && request.query.windowHours.trim().length > 0
      ? Number(request.query.windowHours)
      : undefined;
  const parsedRecentLimit =
    typeof request.query.recentLimit === "string" && request.query.recentLimit.trim().length > 0
      ? Number(request.query.recentLimit)
      : undefined;
  const parsedSummaryLimit =
    typeof request.query.summaryLimit === "string" && request.query.summaryLimit.trim().length > 0
      ? Number(request.query.summaryLimit)
      : undefined;

  return {
    ops: await store.getRouteDecisionOpsSummary({
      windowHours: Number.isFinite(parsedWindowHours) ? parsedWindowHours : 72,
      recentLimit: Number.isFinite(parsedRecentLimit) ? parsedRecentLimit : 12,
      summaryLimit: Number.isFinite(parsedSummaryLimit) ? parsedSummaryLimit : 6
    })
  };
});

app.get<{
  Querystring: {
    includeResolved?: string;
    limit?: string;
    refresh?: string;
    windowHours?: string;
    recentLimit?: string;
    summaryLimit?: string;
  };
}>("/api/ops/alerts", async (request, reply) => {
  const context = await getRequestAuthContext(request);
  if (!requireAdminAuthSession(context, reply)) {
    return {
      error: context.auth.isAuthenticated ? "Admin access required" : "Authentication required"
    };
  }

  const parsedLimit =
    typeof request.query.limit === "string" && request.query.limit.trim().length > 0
      ? Number(request.query.limit)
      : undefined;
  const parsedWindowHours =
    typeof request.query.windowHours === "string" && request.query.windowHours.trim().length > 0
      ? Number(request.query.windowHours)
      : undefined;
  const parsedRecentLimit =
    typeof request.query.recentLimit === "string" && request.query.recentLimit.trim().length > 0
      ? Number(request.query.recentLimit)
      : undefined;
  const parsedSummaryLimit =
    typeof request.query.summaryLimit === "string" && request.query.summaryLimit.trim().length > 0
      ? Number(request.query.summaryLimit)
      : undefined;

  return {
    alerts: await store.listOpsAlerts({
      includeResolved: request.query.includeResolved === "true",
      refresh: request.query.refresh !== "false",
      limit: Number.isFinite(parsedLimit) ? parsedLimit : 50,
      windowHours: Number.isFinite(parsedWindowHours) ? parsedWindowHours : 72,
      recentLimit: Number.isFinite(parsedRecentLimit) ? parsedRecentLimit : 12,
      summaryLimit: Number.isFinite(parsedSummaryLimit) ? parsedSummaryLimit : 6
    })
  };
});

app.post<{
  Params: {
    alertId: string;
  };
}>("/api/ops/alerts/:alertId/acknowledge", async (request, reply) => {
  const context = await getRequestAuthContext(request);
  if (!requireAdminAuthSession(context, reply)) {
    return {
      error: context.auth.isAuthenticated ? "Admin access required" : "Authentication required"
    };
  }

  const alertId = request.params.alertId?.trim();
  if (!alertId) {
    reply.code(400);
    return {
      error: "alertId is required"
    };
  }

  return {
    alert: await store.acknowledgeOpsAlert(alertId)
  };
});

app.post<{
  Params: {
    alertId: string;
  };
  Body: SnoozeOpsAlertBody;
}>("/api/ops/alerts/:alertId/snooze", async (request, reply) => {
  const context = await getRequestAuthContext(request);
  if (!requireAdminAuthSession(context, reply)) {
    return {
      error: context.auth.isAuthenticated ? "Admin access required" : "Authentication required"
    };
  }

  const alertId = request.params.alertId?.trim();
  if (!alertId) {
    reply.code(400);
    return {
      error: "alertId is required"
    };
  }

  const minutes = request.body?.minutes;
  if (minutes !== undefined && (!Number.isFinite(minutes) || minutes < 1)) {
    reply.code(400);
    return {
      error: "minutes must be a positive number"
    };
  }

  return {
    alert: await store.snoozeOpsAlert(alertId, minutes ?? 60)
  };
});

app.post<{
  Params: {
    alertId: string;
  };
}>("/api/ops/alerts/:alertId/unacknowledge", async (request, reply) => {
  const context = await getRequestAuthContext(request);
  if (!requireAdminAuthSession(context, reply)) {
    return {
      error: context.auth.isAuthenticated ? "Admin access required" : "Authentication required"
    };
  }

  const alertId = request.params.alertId?.trim();
  if (!alertId) {
    reply.code(400);
    return {
      error: "alertId is required"
    };
  }

  return {
    alert: await store.unacknowledgeOpsAlert(alertId)
  };
});

app.get<{
  Params: {
    alertId: string;
  };
}>("/api/ops/alerts/:alertId/escalation-preview", async (request, reply) => {
  const context = await getRequestAuthContext(request);
  if (!requireAdminAuthSession(context, reply)) {
    return {
      error: context.auth.isAuthenticated ? "Admin access required" : "Authentication required"
    };
  }

  const alertId = request.params.alertId?.trim();
  if (!alertId) {
    reply.code(400);
    return {
      error: "alertId is required"
    };
  }

  try {
    return {
      preview: await store.getOpsAlertEscalationPreview(alertId)
    };
  } catch (error) {
    if (error instanceof Error && error.message === "Ops alert not found") {
      reply.code(404);
      return {
        error: error.message
      };
    }

    throw error;
  }
});

app.get<{
  Params: {
    alertId: string;
  };
  Querystring: {
    limit?: string;
  };
}>("/api/ops/alerts/:alertId/deliveries", async (request, reply) => {
  const context = await getRequestAuthContext(request);
  if (!requireAdminAuthSession(context, reply)) {
    return {
      error: context.auth.isAuthenticated ? "Admin access required" : "Authentication required"
    };
  }

  const alertId = request.params.alertId?.trim();
  if (!alertId) {
    reply.code(400);
    return {
      error: "alertId is required"
    };
  }

  const parsedLimit =
    typeof request.query.limit === "string" && request.query.limit.trim().length > 0
      ? Number(request.query.limit)
      : undefined;

  try {
    return {
      deliveries: await store.listOpsAlertDeliveries(alertId, Number.isFinite(parsedLimit) ? parsedLimit : 10)
    };
  } catch (error) {
    if (error instanceof Error && error.message === "Ops alert not found") {
      reply.code(404);
      return {
        error: error.message
      };
    }

    throw error;
  }
});

app.post<{
  Params: {
    alertId: string;
  };
}>("/api/ops/alerts/:alertId/deliver", async (request, reply) => {
  const context = await getRequestAuthContext(request);
  if (!requireAdminAuthSession(context, reply)) {
    return {
      error: context.auth.isAuthenticated ? "Admin access required" : "Authentication required"
    };
  }

  const alertId = request.params.alertId?.trim();
  if (!alertId) {
    reply.code(400);
    return {
      error: "alertId is required"
    };
  }

  try {
    return await store.deliverOpsAlert(alertId, context.auth.userId ?? null);
  } catch (error) {
    if (error instanceof Error && error.message === "Ops alert not found") {
      reply.code(404);
      return {
        error: error.message
      };
    }

    if (error instanceof Error && error.message === "Ops alert does not currently require escalation delivery") {
      reply.code(409);
      return {
        error: error.message
      };
    }

    if (error instanceof Error && error.message === "Digest-level ops alerts must be delivered through the digest batch flow") {
      reply.code(409);
      return {
        error: error.message
      };
    }

    if (error instanceof Error && error.message.includes("cooldown policy")) {
      reply.code(409);
      return {
        error: error.message
      };
    }

    throw error;
  }
});

app.post<{
  Params: {
    alertId: string;
    deliveryId: string;
  };
}>("/api/ops/alerts/:alertId/deliveries/:deliveryId/retry", async (request, reply) => {
  const context = await getRequestAuthContext(request);
  if (!requireAdminAuthSession(context, reply)) {
    return {
      error: context.auth.isAuthenticated ? "Admin access required" : "Authentication required"
    };
  }

  const alertId = request.params.alertId?.trim();
  const deliveryId = request.params.deliveryId?.trim();
  if (!alertId || !deliveryId) {
    reply.code(400);
    return {
      error: "alertId and deliveryId are required"
    };
  }

  try {
    return {
      deliveries: await store.retryOpsAlertDelivery(alertId, deliveryId, context.auth.userId ?? null)
    };
  } catch (error) {
    if (error instanceof Error && error.message === "Ops alert not found") {
      reply.code(404);
      return {
        error: error.message
      };
    }

    if (
      error instanceof Error &&
      (error.message === "Ops alert delivery not found" ||
        error.message === "Only failed ops alert deliveries can be retried manually" ||
        error.message === "Ops alert digest batch could not be reconstructed for retry")
    ) {
      reply.code(409);
      return {
        error: error.message
      };
    }

    throw error;
  }
});

app.post<{
  Params: {
    alertId: string;
    deliveryId: string;
  };
}>("/api/ops/alerts/:alertId/deliveries/:deliveryId/resend", async (request, reply) => {
  const context = await getRequestAuthContext(request);
  if (!requireAdminAuthSession(context, reply)) {
    return {
      error: context.auth.isAuthenticated ? "Admin access required" : "Authentication required"
    };
  }

  const alertId = request.params.alertId?.trim();
  const deliveryId = request.params.deliveryId?.trim();
  if (!alertId || !deliveryId) {
    reply.code(400);
    return {
      error: "alertId and deliveryId are required"
    };
  }

  try {
    return {
      deliveries: await store.resendOpsAlertDelivery(alertId, deliveryId, context.auth.userId ?? null)
    };
  } catch (error) {
    if (error instanceof Error && error.message === "Ops alert not found") {
      reply.code(404);
      return {
        error: error.message
      };
    }

    if (
      error instanceof Error &&
      (error.message === "Ops alert delivery not found" ||
        error.message === "Only delivered ops alert deliveries can be resent manually" ||
        error.message === "Ops alert digest batch could not be reconstructed for resend")
    ) {
      reply.code(409);
      return {
        error: error.message
      };
    }

    throw error;
  }
});

app.post("/api/ops/alerts/digest-deliver", async (request, reply) => {
  const context = await getRequestAuthContext(request);
  if (!requireAdminAuthSession(context, reply)) {
    return {
      error: context.auth.isAuthenticated ? "Admin access required" : "Authentication required"
    };
  }

  try {
    return await store.deliverOpsAlertDigest(context.auth.userId ?? null);
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message === "No active watch-level ops alerts currently require digest delivery" ||
        error.message === "Ops alert digest does not have any active admin recipients" ||
        error.message === "Ops alert digest delivery is currently held by cooldown policy" ||
        error.message === "Ops alert digest delivery is currently held by digest cadence policy" ||
        error.message === "Ops alert digest delivery is currently held by quiet window policy")
    ) {
      reply.code(409);
      return {
        error: error.message
      };
    }

    throw error;
  }
});

app.get("/api/admin/users", async (request, reply) => {
  const context = await getRequestAuthContext(request);
  if (!requireAdminAuthSession(context, reply)) {
    return {
      error: context.auth.isAuthenticated ? "Admin access required" : "Authentication required"
    };
  }

  return {
    users: await store.listAdminUsers()
  };
});

app.patch<{
  Params: {
    userId: string;
  };
  Body: UpdateUserAdminBody;
}>("/api/admin/users/:userId", async (request, reply) => {
  const context = await getRequestAuthContext(request);
  if (!requireAdminAuthSession(context, reply)) {
    return {
      error: context.auth.isAuthenticated ? "Admin access required" : "Authentication required"
    };
  }

  const userId = request.params.userId?.trim();

  if (!userId) {
    reply.code(400);
    return {
      error: "userId is required"
    };
  }

  if (
    request.body?.isAdmin === undefined &&
    request.body?.opsAlertImmediateEnabled === undefined &&
    request.body?.opsAlertDigestEnabled === undefined &&
    request.body?.opsAlertEscalationTier === undefined
  ) {
    reply.code(400);
    return {
      error: "At least one admin/routing field must be provided"
    };
  }

  if (request.body?.isAdmin !== undefined && typeof request.body.isAdmin !== "boolean") {
    reply.code(400);
    return {
      error: "isAdmin must be boolean"
    };
  }

  if (
    request.body?.opsAlertImmediateEnabled !== undefined &&
    typeof request.body.opsAlertImmediateEnabled !== "boolean"
  ) {
    reply.code(400);
    return {
      error: "opsAlertImmediateEnabled must be boolean"
    };
  }

  if (
    request.body?.opsAlertDigestEnabled !== undefined &&
    typeof request.body.opsAlertDigestEnabled !== "boolean"
  ) {
    reply.code(400);
    return {
      error: "opsAlertDigestEnabled must be boolean"
    };
  }

  if (
    request.body?.opsAlertEscalationTier !== undefined &&
    request.body.opsAlertEscalationTier !== "primary" &&
    request.body.opsAlertEscalationTier !== "secondary"
  ) {
    reply.code(400);
    return {
      error: "opsAlertEscalationTier must be primary or secondary"
    };
  }

  try {
    const user = await store.updateAdmin({
      userId,
      isAdmin: request.body.isAdmin,
      opsAlertImmediateEnabled: request.body.opsAlertImmediateEnabled,
      opsAlertDigestEnabled: request.body.opsAlertDigestEnabled,
      opsAlertEscalationTier: request.body.opsAlertEscalationTier
    });

    return {
      user
    };
  } catch (error) {
    if (error instanceof Error && "statusCode" in error && typeof error.statusCode === "number") {
      reply.code(error.statusCode);
      return {
        error: error.message
      };
    }

    throw error;
  }
});

app.patch<{ Body: UpdateAccountProfileBody }>("/api/account/profile", async (request, reply) => {
  return withStateLock(async () => {
    const context = await getRequestAuthContext(request);
    if (!requireAuthenticatedAuthSession(context, reply)) {
      return {
        error: "Authentication required"
      };
    }

    const displayName = request.body?.displayName?.trim();
    const contact = request.body?.contact?.trim();

    if (!displayName || !contact) {
      reply.code(400);
      return {
        error: "Display name and contact are required"
      };
    }

    const nextAccount = {
      ...context.account,
      user: {
        ...context.account.user,
        displayName,
        contact,
        contactType: trimmedContactLooksLikeEmail(contact) ? ("email" as const) : ("telegram" as const)
      }
    };
    await store.writeState({
      auth: context.auth,
      session: state,
      account: nextAccount
    });

    return {
      account: nextAccount
    };
  });
});

app.post<{ Body: TelemetryNetworkContext }>("/api/connect", async (request, reply) => {
  return withStateLock(async () => {
    try {
      const context = await getRequestAuthContext(request);
      if (!requireAuthenticatedAuthSession(context, reply)) {
        return {
          error: "Authentication required"
        };
      }
      state.status = state.status === "connected" ? "disconnected" : "connected";
      state.connectCount += 1;
      const resolved = await resolveRouteDecision(context.auth, request.body);
      const selectedEndpointId = resolved.routePolicy.recommendedEndpointId ?? state.activeServerId;

      if (state.status === "connected") {
        state.activeServerId = selectedEndpointId;
      }

      state.updatedAt = new Date().toISOString();
      await store.writeSession(state);

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

app.post<{ Body: { serverId?: string } & TelemetryNetworkContext }>("/api/server", async (request, reply) => {
  return withStateLock(async () => {
    try {
      const context = await getRequestAuthContext(request);
      if (!requireAuthenticatedAuthSession(context, reply)) {
        return {
          error: "Authentication required"
        };
      }
      const { serverId } = request.body;
      const resolved = await resolveRouteDecision(context.auth, {
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
      await store.writeSession(state);
      const currentAssignment = await store.assignEndpoint(context.auth, {
        endpointId: nextServer.id,
        assignmentReason: "manual_select",
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
      });
      const routePolicy = buildRoutePolicy({
        servers: resolved.servers,
        currentAssignmentEndpointId: currentAssignment?.endpointId ?? nextServer.id,
        currentAssignmentReason: currentAssignment?.assignmentReason ?? "manual_select",
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
});

const port = Number(process.env.PORT ?? 8080);
const host = process.env.HOST ?? "0.0.0.0";

try {
  await app.listen({ port, host });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
