import type { FastifyInstance } from "fastify";
import type { BackendRuntime } from "../runtime.js";
import { routeFeedbackBodySchema, telemetryProbeBodySchema } from "../schemas.js";
import type {
  RecordRouteFeedbackInput,
  RouteFeedbackBody,
  RouteFeedbackSource,
  TelemetryFailureReason,
  TelemetryProbeBody,
  TelemetryProbeResult
} from "../types.js";
import {
  getRequestAuthContext,
  isStatusCodeError,
  replyWithStatusCodeError,
  requireAuthenticatedAuthSession
} from "./context.js";

export function registerTelemetryRoutes(app: FastifyInstance, runtime: BackendRuntime) {
  const store = runtime.store;

  app.post<{ Body: TelemetryProbeBody }>(
    "/api/telemetry/probe",
    { schema: { body: telemetryProbeBodySchema } },
    async (request, reply) => {
      const context = await getRequestAuthContext(runtime, request);
      if (!requireAuthenticatedAuthSession(context, reply)) {
        return {
          error: "Authentication required"
        };
      }
      const endpointId = request.body.endpointId!.trim();
      const transportProfile = request.body.transportProfile!.trim();
      const result = request.body.result!;
      const failureReason = request.body.failureReason;
      const testedAt = request.body.testedAt!.trim();

      if (Number.isNaN(Date.parse(testedAt))) {
        reply.code(400);
        return {
          error: "testedAt must be a valid ISO date"
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
        if (isStatusCodeError(error)) {
          return replyWithStatusCodeError(reply, error);
        }

        throw error;
      }

      reply.code(202);
      return {
        accepted: true
      };
    }
  );

  app.post<{ Body: RouteFeedbackBody }>(
    "/api/routes/feedback",
    { schema: { body: routeFeedbackBodySchema } },
    async (request, reply) => {
      const context = await getRequestAuthContext(runtime, request);
      if (!requireAuthenticatedAuthSession(context, reply)) {
        return {
          error: "Authentication required"
        };
      }
      const endpointId = request.body.endpointId!.trim();
      const transportProfile = request.body.transportProfile!.trim();
      const result = request.body.result!;
      const failureReason = request.body.failureReason;
      const occurredAt = request.body.occurredAt!.trim();
      const source = request.body.source;

      if (Number.isNaN(Date.parse(occurredAt))) {
        reply.code(400);
        return {
          error: "occurredAt must be a valid ISO date"
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
        if (isStatusCodeError(error)) {
          return replyWithStatusCodeError(reply, error);
        }

        throw error;
      }

      reply.code(202);
      return {
        accepted: true
      };
    }
  );
}
