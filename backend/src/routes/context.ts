import { timingSafeEqual } from "node:crypto";

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

// Выделенный scoped-токен для deploy/xray/sync-clients.sh (крон на каждой
// Xray-ноде). До него крон ходил с полной admin-сессией (x-auth-session-id),
// что означало: (1) сессия истекает через authSessionTtlMs и крон молча
// умирает через ~30 дней; (2) утечка значения из crontab давала весь admin
// API, а не только read-only список клиентов. Токен статический (env
// FLEET_SYNC_TOKEN), без срока жизни, и валиден ТОЛЬКО для эндпоинтов, где
// его явно проверяют. Пустой/не заданный env полностью выключает этот путь.
export function isValidFleetSyncToken(request: {
  headers: Record<string, string | string[] | undefined>;
}) {
  const expected = process.env.FLEET_SYNC_TOKEN ?? "";
  if (expected.length < 16) {
    // Слишком короткий токен — считаем фичу выключенной, чтобы случайный
    // "test"/"1" в env не превратился в реальный обход admin-аутентификации.
    return false;
  }

  const rawHeader = request.headers["x-fleet-sync-token"];
  const provided = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
  if (!provided) {
    return false;
  }

  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  if (expectedBuffer.length !== providedBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, providedBuffer);
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
