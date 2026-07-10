import type { FastifyInstance } from "fastify";
import type { BackendRuntime } from "../runtime.js";
import type { SnoozeOpsAlertBody } from "../types.js";
import { withAdminAuth } from "./context.js";

export function registerOpsAlertRoutes(app: FastifyInstance, runtime: BackendRuntime) {
  const store = runtime.store;

  app.get<{
    Querystring: {
      includeResolved?: string;
      limit?: string;
      refresh?: string;
      windowHours?: string;
      recentLimit?: string;
      summaryLimit?: string;
    };
  }>(
    "/api/ops/alerts",
    withAdminAuth(runtime, async (request) => {
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
    })
  );

  app.post<{
    Params: {
      alertId: string;
    };
  }>(
    "/api/ops/alerts/:alertId/acknowledge",
    withAdminAuth(runtime, async (request, reply) => {
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
    })
  );

  app.post<{
    Params: {
      alertId: string;
    };
    Body: SnoozeOpsAlertBody;
  }>(
    "/api/ops/alerts/:alertId/snooze",
    withAdminAuth(runtime, async (request, reply) => {
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
    })
  );

  app.post<{
    Params: {
      alertId: string;
    };
  }>(
    "/api/ops/alerts/:alertId/unacknowledge",
    withAdminAuth(runtime, async (request, reply) => {
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
    })
  );

  app.get<{
    Params: {
      alertId: string;
    };
  }>(
    "/api/ops/alerts/:alertId/escalation-preview",
    withAdminAuth(runtime, async (request, reply) => {
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
    })
  );

  app.get<{
    Params: {
      alertId: string;
    };
    Querystring: {
      limit?: string;
    };
  }>(
    "/api/ops/alerts/:alertId/deliveries",
    withAdminAuth(runtime, async (request, reply) => {
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
    })
  );

  app.post<{
    Params: {
      alertId: string;
    };
  }>(
    "/api/ops/alerts/:alertId/deliver",
    withAdminAuth(runtime, async (request, reply, context) => {
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
    })
  );

  app.post<{
    Params: {
      alertId: string;
      deliveryId: string;
    };
  }>(
    "/api/ops/alerts/:alertId/deliveries/:deliveryId/retry",
    withAdminAuth(runtime, async (request, reply, context) => {
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
    })
  );

  app.post<{
    Params: {
      alertId: string;
      deliveryId: string;
    };
  }>(
    "/api/ops/alerts/:alertId/deliveries/:deliveryId/resend",
    withAdminAuth(runtime, async (request, reply, context) => {
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
    })
  );

  app.post(
    "/api/ops/alerts/digest-deliver",
    withAdminAuth(runtime, async (_request, reply, context) => {
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
    })
  );
}
