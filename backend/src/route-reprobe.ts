import { randomUUID } from "node:crypto";

import type {
  AuthSessionSummary,
  RecordRouteFeedbackInput,
  RouteHealthSnapshotSummary,
  RoutePolicySummary,
  RouteReprobeCandidateSummary,
  RouteReprobeJobBody,
  RouteReprobeJobSummary,
  TelemetryNetworkContext
} from "./types.js";
import type { ClaimedRouteReprobeJob } from "./store/route-reprobe-jobs.js";

const defaultCandidateLimit = 3;
const defaultLeaseMs = 30_000;
const defaultPollIntervalMs = 2_000;

function clampCandidateLimit(input?: number) {
  if (!Number.isFinite(input)) {
    return defaultCandidateLimit;
  }

  return Math.min(Math.max(Math.trunc(input as number), 1), 5);
}

export function selectRouteReprobeCandidates(
  routePolicy: RoutePolicySummary,
  routeHealth: RouteHealthSnapshotSummary[],
  candidateLimit?: number
): RouteReprobeCandidateSummary[] {
  const limit = clampCandidateLimit(candidateLimit);
  const routeHealthMap = new Map(routeHealth.map((snapshot) => [snapshot.endpointId, snapshot]));

  return routePolicy.shortlist.slice(0, limit).map((candidate) => {
    const snapshot = routeHealthMap.get(candidate.endpointId);

    return {
      endpointId: candidate.endpointId,
      transportProfile: candidate.transportProfile,
      assignmentReason: candidate.assignmentReason,
      provider: candidate.provider,
      region: candidate.region,
      healthStatus: snapshot?.status ?? "unknown",
      penaltyScore: snapshot?.penaltyScore ?? null,
      dominantFailureReason: snapshot?.dominantFailureReason ?? null
    };
  });
}

type ResolveRouteDecisionResult = {
  routeContext?: TelemetryNetworkContext;
  routeHealth: RouteHealthSnapshotSummary[];
  routePolicy: RoutePolicySummary;
};

type RouteReprobeQueueDependencies = {
  auth: () => AuthSessionSummary | Promise<AuthSessionSummary>;
  resolveRouteDecision: (input?: RouteReprobeJobBody | TelemetryNetworkContext | null) => Promise<ResolveRouteDecisionResult>;
  recordRouteFeedback: (auth: AuthSessionSummary, input: RecordRouteFeedbackInput) => Promise<void>;
  recordRouteWorkflowSnapshot: (
    auth: AuthSessionSummary,
    input: {
      context?: TelemetryNetworkContext;
      note?: string | null;
      candidateLimit: number;
      recommendedEndpointId: string | null;
      candidates: RouteReprobeCandidateSummary[];
      routePolicy: RoutePolicySummary;
    }
  ) => Promise<void>;
  enqueueJob: (input: RouteReprobeJobBody & { candidateLimit: number }) => Promise<RouteReprobeJobSummary>;
  listJobs: () => Promise<RouteReprobeJobSummary[]>;
  claimNextJob: (input: { workerId: string; leaseMs: number }) => Promise<ClaimedRouteReprobeJob | null>;
  completeJob: (input: {
    jobId: string;
    context: TelemetryNetworkContext;
    candidateLimit: number;
    recommendedEndpointId: string | null;
    candidates: RouteReprobeCandidateSummary[];
    recordedResultsCount: number;
  }) => Promise<void>;
  failJob: (input: { jobId: string; message: string }) => Promise<void>;
  leaseMs?: number;
  pollIntervalMs?: number;
};

export function normalizeRouteReprobeCandidateLimit(input?: number) {
  return clampCandidateLimit(input);
}

export function createRouteReprobeWorker(deps: RouteReprobeQueueDependencies) {
  const workerId = randomUUID();
  const leaseMs = deps.leaseMs ?? defaultLeaseMs;
  const pollIntervalMs = deps.pollIntervalMs ?? defaultPollIntervalMs;

  let timer: NodeJS.Timeout | null = null;
  let running = false;
  let started = false;

  const schedule = (delayMs: number) => {
    if (!started) {
      return;
    }

    if (timer) {
      clearTimeout(timer);
    }

    timer = setTimeout(() => {
      timer = null;
      void tick();
    }, delayMs);
  };

  const runJob = async (job: ClaimedRouteReprobeJob) => {
    try {
      const auth = await deps.auth();
      const resolved = await deps.resolveRouteDecision(job.context);
      const candidateLimit = clampCandidateLimit(job.candidateLimit);
      const candidates = selectRouteReprobeCandidates(resolved.routePolicy, resolved.routeHealth, candidateLimit);

      await deps.recordRouteWorkflowSnapshot(auth, {
        context: resolved.routeContext,
        note: job.note ?? null,
        candidateLimit,
        recommendedEndpointId: resolved.routePolicy.recommendedEndpointId,
        candidates,
        routePolicy: resolved.routePolicy
      });

      let recordedResultsCount = 0;

      for (const result of job.results) {
        if (!result.endpointId || !result.transportProfile || !result.result) {
          continue;
        }

        await deps.recordRouteFeedback(auth, {
          endpointId: result.endpointId,
          transportProfile: result.transportProfile,
          result: result.result,
          failureReason: result.failureReason,
          occurredAt: result.occurredAt ?? new Date().toISOString(),
          latencyMs: result.latencyMs,
          appVersion: job.appVersion ?? undefined,
          source: "runtime_reprobe",
          note: job.note ?? undefined,
          networkType: resolved.routeContext?.networkType,
          carrier: resolved.routeContext?.carrier,
          asn: resolved.routeContext?.asn,
          countryCode: resolved.routeContext?.countryCode,
          region: resolved.routeContext?.region
        });
        recordedResultsCount += 1;
      }

      await deps.completeJob({
        jobId: job.id,
        context: resolved.routeContext ?? job.context,
        candidateLimit,
        recommendedEndpointId: resolved.routePolicy.recommendedEndpointId,
        candidates,
        recordedResultsCount
      });
    } catch (error) {
      await deps.failJob({
        jobId: job.id,
        message: error instanceof Error ? error.message : "Unknown route reprobe error"
      });
    }
  };

  const runOnce = async () => {
    if (running) {
      return false;
    }

    running = true;
    try {
      const job = await deps.claimNextJob({ workerId, leaseMs });
      if (!job) {
        return false;
      }

      await runJob(job);
      return true;
    } finally {
      running = false;
    }
  };

  const tick = async () => {
    const processed = await runOnce();
    schedule(processed ? 0 : pollIntervalMs);
  };

  return {
    start() {
      if (started) {
        return;
      }

      started = true;
      schedule(0);
    },

    stop() {
      started = false;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },

    runOnce
  };
}
