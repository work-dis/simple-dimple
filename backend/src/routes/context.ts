import type { FastifyReply, FastifyRequest, RouteGenericInterface } from "fastify";
import type { BackendRuntime } from "../runtime.js";
import type { ResolveRoutesBody, TelemetryNetworkContext } from "../types.js";

// Общие для всех route-модулей (backend/src/routes/*.ts) auth/error хелперы —
// раньше жили в server.ts как приватные функции одного файла на 1500+ строк;
// вынесены сюда, чтобы каждый route-модуль тянул их явным импортом, а не
// полагался на общий scope одного файла.

export type RequestAuthContext = Awaited<ReturnType<BackendRuntime["loadAuthContext"]>>;

export async function getRequestAuthContext(
  runtime: BackendRuntime,
  request: { headers: Record<string, string | string[] | undefined> }
) {
  const rawSessionId = request.headers["x-auth-session-id"];
  const sessionId = Array.isArray(rawSessionId) ? rawSessionId[0] : rawSessionId;
  return runtime.loadAuthContext(sessionId);
}

export function requireAuthenticatedAuthSession(
  context: RequestAuthContext,
  reply: Pick<FastifyReply, "code">
) {
  if (context.auth.isAuthenticated) {
    return true;
  }

  reply.code(401);
  return false;
}

// Per-user connection-state (session status/activeServerId) требует реального
// userId — авторизованная, но не привязанная к юзеру auth-сессия сюда не годится.
export function requireAuthenticatedUserId(
  context: RequestAuthContext,
  reply: Pick<FastifyReply, "code">
): string | null {
  if (!requireAuthenticatedAuthSession(context, reply)) {
    return null;
  }

  if (!context.auth.userId) {
    reply.code(401);
    return null;
  }

  return context.auth.userId;
}

export function requireAdminAuthSession(context: RequestAuthContext, reply: Pick<FastifyReply, "code">) {
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

// Оборачивает admin-only route-хендлер: резолвит auth-context, отсекает
// неадминов единым ответом ({error}, 401/403) и передаёт context дальше,
// чтобы хендлеру не пришлось самому дублировать guard+early-return в каждом
// route-модуле (было ~15 копий этого блока в admin.ts/ops-alerts.ts/ops-reprobe.ts).
export function withAdminAuth<T extends RouteGenericInterface = RouteGenericInterface>(
  runtime: BackendRuntime,
  handler: (request: FastifyRequest<T>, reply: FastifyReply, context: RequestAuthContext) => unknown
) {
  return async (request: FastifyRequest<T>, reply: FastifyReply) => {
    const context = await getRequestAuthContext(runtime, request);
    if (!requireAdminAuthSession(context, reply)) {
      return {
        error: context.auth.isAuthenticated ? "Admin access required" : "Authentication required"
      };
    }

    return handler(request, reply, context);
  };
}

export function isStatusCodeError(error: unknown): error is Error & { statusCode: number } {
  return error instanceof Error && "statusCode" in error && typeof error.statusCode === "number";
}

export function replyWithStatusCodeError(
  reply: Pick<FastifyReply, "code">,
  error: Error & { statusCode: number }
) {
  reply.code(error.statusCode);
  return {
    error: error.message
  };
}

export async function resolveRouteDecision(
  runtime: BackendRuntime,
  auth: RequestAuthContext["auth"],
  input?: ResolveRoutesBody | TelemetryNetworkContext | null
) {
  return runtime.resolveRouteDecision(auth, input);
}
