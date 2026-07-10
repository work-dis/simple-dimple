import type { FastifyInstance } from "fastify";
import { normalizeRouteReprobeCandidateLimit } from "../route-reprobe.js";
import type { BackendRuntime } from "../runtime.js";
import { routeReprobeJobBodySchema } from "../schemas.js";
import type { RouteReprobeJobBody } from "../types.js";
import { withAdminAuth } from "./context.js";

export function registerOpsReprobeRoutes(app: FastifyInstance, runtime: BackendRuntime) {
  const store = runtime.store;

  app.get(
    "/api/ops/route-reprobe-jobs",
    withAdminAuth(runtime, async () => {
      return {
        jobs: await store.listRouteReprobeJobs()
      };
    })
  );

  app.post<{ Body: RouteReprobeJobBody }>(
    "/api/ops/route-reprobe-jobs",
    { schema: { body: routeReprobeJobBodySchema } },
    withAdminAuth(runtime, async (request, reply) => {
      const candidateLimit = request.body?.candidateLimit;
      const maxAttempts = request.body?.maxAttempts;

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
    })
  );

  app.get<{
    Querystring: {
      windowHours?: string;
      recentLimit?: string;
      summaryLimit?: string;
    };
  }>(
    "/api/ops/route-decisions",
    withAdminAuth(runtime, async (request) => {
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
    })
  );
}
