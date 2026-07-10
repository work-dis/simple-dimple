import type { FastifyInstance } from "fastify";
import type { BackendRuntime } from "../runtime.js";
import { registerAdminEndpointBodySchema } from "../schemas.js";
import type { RegisterAdminEndpointBody, SetAdminEndpointActiveBody, UpdateUserAdminBody } from "../types.js";
import { isStatusCodeError, replyWithStatusCodeError, withAdminAuth } from "./context.js";

export function registerAdminRoutes(app: FastifyInstance, runtime: BackendRuntime) {
  const store = runtime.store;

  app.get(
    "/api/admin/users",
    withAdminAuth(runtime, async () => {
      return {
        users: await store.listAdminUsers()
      };
    })
  );

  app.patch<{
    Params: {
      userId: string;
    };
    Body: UpdateUserAdminBody;
  }>(
    "/api/admin/users/:userId",
    withAdminAuth(runtime, async (request, reply) => {
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
        if (isStatusCodeError(error)) {
          return replyWithStatusCodeError(reply, error);
        }

        throw error;
      }
    })
  );

  // Шаг 5 (PRIORITY_PLAN.md) — fleet provisioning: список/регистрация/retire
  // Xray-нод без ручной правки backend/src/defaults.ts и без редеплоя backend.
  app.get(
    "/api/admin/endpoints",
    withAdminAuth(runtime, async () => {
      return {
        endpoints: await store.listAdminEndpoints()
      };
    })
  );

  // Шаг 2 (PRIORITY_PLAN.md) — per-node client-list sync: источник правды для
  // deploy/xray/sync-clients.sh (не публичный — раскрывает все выданные
  // vlessUuid, поэтому за тем же requireAdminAuthSession, что и остальной
  // fleet-inventory).
  app.get(
    "/api/admin/vless-clients",
    withAdminAuth(runtime, async () => {
      return {
        clients: await store.listVlessClients()
      };
    })
  );

  app.post<{ Body: RegisterAdminEndpointBody }>(
    "/api/admin/endpoints",
    { schema: { body: registerAdminEndpointBodySchema } },
    withAdminAuth(runtime, async (request, reply) => {
      try {
        const endpoint = await store.registerEndpoint(request.body ?? {});
        reply.code(201);
        return {
          endpoint
        };
      } catch (error) {
        if (isStatusCodeError(error)) {
          return replyWithStatusCodeError(reply, error);
        }

        throw error;
      }
    })
  );

  app.patch<{
    Params: {
      endpointId: string;
    };
    Body: SetAdminEndpointActiveBody;
  }>(
    "/api/admin/endpoints/:endpointId",
    withAdminAuth(runtime, async (request, reply) => {
      const endpointId = request.params.endpointId?.trim();
      if (!endpointId) {
        reply.code(400);
        return {
          error: "endpointId is required"
        };
      }

      if (typeof request.body?.isActive !== "boolean") {
        reply.code(400);
        return {
          error: "isActive must be boolean"
        };
      }

      try {
        return {
          endpoint: await store.setEndpointActive(
            endpointId,
            request.body.isActive,
            request.body.retiredReason?.trim() || undefined
          )
        };
      } catch (error) {
        if (isStatusCodeError(error)) {
          return replyWithStatusCodeError(reply, error);
        }

        throw error;
      }
    })
  );
}
