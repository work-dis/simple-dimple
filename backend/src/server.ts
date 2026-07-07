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
let auth = persistedState.auth;
const state = persistedState.session;
let account = persistedState.account;

// Сохраняем состояние при старте только для аутентифицированных сессий,
// чтобы не upsert-ить демо-пользователя в БД
if (auth.isAuthenticated) {
  await store.writeState({
    auth,
    session: state,
    account
  });
}

const app = Fastify({
  logger: true
});

await app.register(cors, {
  origin: true
});

await app.register(rateLimit, {
  max: 100,
  timeWindow: "1 minute"
});

app.addHook("onClose", async () => {
  await runtime.disconnect();
});

function requireAuthenticatedAuthSession(reply: { code: (statusCode: number) => void }) {
  if (auth.isAuthenticated) {
    return true;
  }

  reply.code(401);
  return false;
}

function requireAdminAuthSession(reply: { code: (statusCode: number) => void }) {
  if (!auth.isAuthenticated) {
    reply.code(401);
    return false;
  }

  if (account.user.isAdmin) {
    return true;
  }

  reply.code(403);
  return false;
}

async function resolveRouteDecision(input?: ResolveRoutesBody | TelemetryNetworkContext | null) {
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
}>("/api/session", async (request) => {
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
  const resolved = await resolveRouteDecision(routeContext);

  return {
    session: state,
    servers: resolved.servers,
    currentAssignment: resolved.currentAssignment,
    routeHealth: resolved.routeHealth,
    routePolicy: resolved.routePolicy
  };
});

app.post<{ Body: ResolveRoutesBody }>("/api/routes/resolve", async (request, reply) => {
  const manualEndpointId = request.body?.manualEndpointId?.trim();
  const includeServers = request.body?.includeServers !== false;
  const resolved = await resolveRouteDecision({
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

  return {
    resolvedAt: new Date().toISOString(),
    routePolicy: resolved.routePolicy,
    routeHealth: resolved.routeHealth,
    currentAssignment: resolved.currentAssignment,
    lastKnownGoodRoute: resolved.lastKnownGoodRoute,
    servers: includeServers ? resolved.servers : undefined
  };
});

app.get("/api/auth/session", async () => {
  return {
    auth
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
    auth = result.auth;
    account = result.account;
  } catch (error) {
    if (error instanceof Error && "statusCode" in error && typeof error.statusCode === "number") {
      reply.code(error.statusCode);
      return {
        error: error.message
      };
    }

    throw error;
  }

  return {
    auth,
    account
  };
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
    auth = result.auth;
    account = result.account;
  } catch (error) {
    if (error instanceof Error && "statusCode" in error && typeof error.statusCode === "number") {
      reply.code(error.statusCode);
      return {
        error: error.message
      };
    }

    throw error;
  }

  return {
    auth,
    account
  };
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
    auth = result.auth;
    account = result.account;
  } catch (error) {
    if (error instanceof Error && "statusCode" in error && typeof error.statusCode === "number") {
      reply.code(error.statusCode);
      return {
        error: error.message
      };
    }

    throw error;
  }

  return {
    auth,
    account
  };
});

app.post("/api/auth/logout", async () => {
  auth = await store.logout();

  return {
    auth
  };
});

app.get("/api/account", async (request, reply) => {
  if (!auth.isAuthenticated) {
    reply.code(401);
    return {
      error: "Authentication required"
    };
  }

  return {
    account
  };
});

app.post<{ Body: TelemetryProbeBody }>("/api/telemetry/probe", async (request, reply) => {
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
    await store.submitProbeReport(auth, {
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

    await store.recordRouteFeedback(auth, feedbackInput);
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
  if (!requireAdminAuthSession(reply)) {
    return {
      error: auth.isAuthenticated ? "Admin access required" : "Authentication required"
    };
  }

  return {
    jobs: await store.listRouteReprobeJobs()
  };
});

app.post<{ Body: RouteReprobeJobBody }>("/api/ops/route-reprobe-jobs", async (request, reply) => {
  if (!requireAdminAuthSession(reply)) {
    return {
      error: auth.isAuthenticated ? "Admin access required" : "Authentication required"
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
  if (!requireAdminAuthSession(reply)) {
    return {
      error: auth.isAuthenticated ? "Admin access required" : "Authentication required"
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

app.get("/api/admin/users", async (request, reply) => {
  if (!requireAdminAuthSession(reply)) {
    return {
      error: auth.isAuthenticated ? "Admin access required" : "Authentication required"
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
  if (!requireAdminAuthSession(reply)) {
    return {
      error: auth.isAuthenticated ? "Admin access required" : "Authentication required"
    };
  }

  const userId = request.params.userId?.trim();

  if (!userId) {
    reply.code(400);
    return {
      error: "userId is required"
    };
  }

  if (typeof request.body?.isAdmin !== "boolean") {
    reply.code(400);
    return {
      error: "isAdmin must be boolean"
    };
  }

  try {
    const user = await store.updateAdmin({ userId, isAdmin: request.body.isAdmin });

    if (auth.userId === user.id) {
      account.user.isAdmin = user.isAdmin;
    }

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
  if (!requireAuthenticatedAuthSession(reply)) {
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

  account.user.displayName = displayName;
  account.user.contact = contact;
  account.user.contactType = trimmedContactLooksLikeEmail(contact) ? "email" : "telegram";
  await store.writeState({
    auth,
    session: state,
    account
  });

  return {
    account
  };
});

app.post<{ Body: TelemetryNetworkContext }>("/api/connect", async (request) => {
  state.status = state.status === "connected" ? "disconnected" : "connected";
  state.connectCount += 1;
  const resolved = await resolveRouteDecision(request.body);
  const selectedEndpointId = resolved.routePolicy.recommendedEndpointId ?? state.activeServerId;

  if (state.status === "connected") {
    state.activeServerId = selectedEndpointId;
  }

  state.updatedAt = new Date().toISOString();
  await store.writeSession(state);

  const currentAssignment =
    state.status === "connected"
      ? await store.assignEndpoint(auth, {
          endpointId: selectedEndpointId,
          assignmentReason: resolved.routePolicy.recommendedReason ?? "connect_request",
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
        })
      : resolved.currentAssignment;
  const nextLastKnownGoodRoute =
    state.status === "connected"
      ? await store.recordLastKnownGoodRoute(auth, {
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

  return {
    session: state,
    currentAssignment,
    routeHealth: resolved.routeHealth,
    routePolicy: nextRoutePolicy
  };
});

app.post<{ Body: { serverId?: string } & TelemetryNetworkContext }>("/api/server", async (request, reply) => {
  const { serverId } = request.body;
  const resolved = await resolveRouteDecision({
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
  const currentAssignment = await store.assignEndpoint(auth, {
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

  return {
    session: state,
    activeServer: nextServer,
    currentAssignment,
    routeHealth: resolved.routeHealth,
    routePolicy
  };
});

const port = Number(process.env.PORT ?? 8080);
const host = process.env.HOST ?? "0.0.0.0";

try {
  await app.listen({ port, host });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
