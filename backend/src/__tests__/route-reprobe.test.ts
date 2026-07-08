import { describe, expect, it } from "vitest";

import { createRouteReprobeWorker, selectRouteReprobeCandidates } from "../route-reprobe.js";
import { computeRouteReprobeBackoffMs } from "../store/route-reprobe-jobs.js";
import type { ClaimedRouteReprobeJob } from "../store/route-reprobe-jobs.js";
import type { RouteHealthSnapshotSummary, RoutePolicySummary } from "../types.js";

const routePolicy: RoutePolicySummary = {
  recommendedEndpointId: "ep-1",
  recommendedReason: "network_ranking_primary",
  shortlist: [
    {
      endpointId: "ep-1",
      assignmentReason: "network_ranking_primary",
      label: "Endpoint 1",
      region: "PL-WAW",
      provider: "Provider A",
      asn: 64500,
      ipAddress: "203.0.113.10",
      poolCode: "pool-a",
      protocol: "vless",
      transportProfile: "reality",
      latencyMs: 45,
      loadPercent: 30
    },
    {
      endpointId: "ep-2",
      assignmentReason: "provider_diversity_fallback",
      label: "Endpoint 2",
      region: "PL-KRK",
      provider: "Provider B",
      asn: 64501,
      ipAddress: "203.0.113.11",
      poolCode: "pool-b",
      protocol: "trojan",
      transportProfile: "tls",
      latencyMs: 55,
      loadPercent: 40
    }
  ],
  trace: {
    selectedBy: "network_ranking",
    usedManualOverride: false,
    usedLastKnownGood: false,
    usedNetworkRanking: true,
    usedHealthAwarePrimarySelection: false,
    usedRouteHealthPenalties: true,
    usedHealthAwareShortlist: true,
    usedDegradedAvoidance: false,
    routeHealthAvoidedCount: 0,
    routeHealthPenalizedCount: 1,
    degradedEndpointCount: 0,
    fallbackTier: "ranking",
    diversityStageReached: "partial",
    shortlistDistinctProviders: 2,
    shortlistDistinctAsns: 2,
    shortlistPenalizedCount: 1,
    topPenaltyReason: "timeout",
    topPenaltyConfidence: 0.8,
    recommendedEndpointHealth: "healthy",
    recommendedEndpointPenaltyScore: 0,
    recommendedEndpointFailureReason: null,
    primaryCandidateEndpointId: "ep-1",
    primaryCandidateHealth: "healthy",
    primaryCandidatePenaltyScore: 0,
    healthAdjustedPrimaryEndpointId: null
  }
};

const routeHealth: RouteHealthSnapshotSummary[] = [
  {
    endpointId: "ep-2",
    penaltyScore: 12.5,
    confidence: 0.8,
    freshFailureCount: 2,
    dominantFailureReason: "timeout",
    lastFailureAt: "2026-07-07T09:00:00.000Z",
    status: "penalized"
  }
];

describe("selectRouteReprobeCandidates", () => {
  it("annotates candidates with route health", () => {
    const candidates = selectRouteReprobeCandidates(routePolicy, routeHealth, 2);

    expect(candidates).toHaveLength(2);
    expect(candidates[0].endpointId).toBe("ep-1");
    expect(candidates[0].healthStatus).toBe("unknown");
    expect(candidates[1].endpointId).toBe("ep-2");
    expect(candidates[1].healthStatus).toBe("penalized");
    expect(candidates[1].dominantFailureReason).toBe("timeout");
  });

  it("clamps candidate limit", () => {
    expect(selectRouteReprobeCandidates(routePolicy, routeHealth, 1)).toHaveLength(1);
    expect(selectRouteReprobeCandidates(routePolicy, routeHealth, 99)).toHaveLength(2);
  });
});

describe("createRouteReprobeWorker", () => {
  it("processes a claimed persisted job and completes it with candidates", async () => {
    let claimed = false;
    let snapshotRecorded = false;
    let feedbackRecorded = 0;
    let completion:
      | {
          jobId: string;
          recommendedEndpointId: string | null;
          recordedResultsCount: number;
          candidates: Array<{ endpointId: string }>;
        }
      | undefined;

    const claimedJob: ClaimedRouteReprobeJob = {
      id: "job-1",
      status: "running",
      createdAt: "2026-07-07T10:00:00.000Z",
      startedAt: "2026-07-07T10:00:01.000Z",
      completedAt: null,
      context: {
        networkType: "wifi",
        countryCode: "PL"
      },
      note: "nightly reprobe",
      candidateLimit: 2,
      recommendedEndpointId: null,
      candidates: [],
      recordedResultsCount: 0,
      failureMessage: null,
      maxAttempts: 3,
      nextAttemptAt: null,
      leaseExpiresAt: "2026-07-07T10:00:31.000Z",
      leaseReclaimedCount: 0,
      deadLetteredAt: null,
      attemptAudit: [],
      appVersion: "1.2.3",
      results: [
        {
          endpointId: "ep-2",
          transportProfile: "tls",
          result: "unstable",
          latencyMs: 280
        }
      ],
      attempts: 1,
      workerId: "worker-1"
    };

    const queue = createRouteReprobeWorker({
      auth: () => ({
        id: "auth-1",
        userId: "user-1",
        provider: "credentials",
        status: "active",
        isAuthenticated: true,
        lastAuthenticatedAt: null,
        expiresAt: null
      }),
      resolveRouteDecision: async () => ({
        routeContext: claimedJob.context,
        routeHealth,
        routePolicy
      }),
      recordRouteFeedback: async () => {
        feedbackRecorded += 1;
      },
      recordRouteWorkflowSnapshot: async () => {
        snapshotRecorded = true;
      },
      enqueueJob: async () => {
        throw new Error("enqueueJob should not be called in runOnce test");
      },
      listJobs: async () => [],
      claimNextJob: async () => {
        if (claimed) {
          return null;
        }

        claimed = true;
        return claimedJob;
      },
      completeJob: async (input) => {
        completion = {
          jobId: input.jobId,
          recommendedEndpointId: input.recommendedEndpointId,
          recordedResultsCount: input.recordedResultsCount,
          candidates: input.candidates.map((candidate) => ({ endpointId: candidate.endpointId }))
        };
      },
      failJob: async () => {
        throw new Error("failJob should not be called for successful processing");
      }
    });

    await expect(queue.runOnce()).resolves.toBe(true);
    expect(snapshotRecorded).toBe(true);
    expect(feedbackRecorded).toBe(1);
    expect(completion).toEqual({
      jobId: "job-1",
      recommendedEndpointId: "ep-1",
      recordedResultsCount: 1,
      candidates: [{ endpointId: "ep-1" }, { endpointId: "ep-2" }]
    });
  });

  it("sends failures to the job store for retry/dead-letter handling", async () => {
    let failedMessage: string | null = null;

    const claimedJob: ClaimedRouteReprobeJob = {
      id: "job-2",
      status: "running",
      createdAt: "2026-07-07T10:00:00.000Z",
      startedAt: "2026-07-07T10:00:01.000Z",
      completedAt: null,
      context: {
        networkType: "wifi",
        countryCode: "PL"
      },
      note: "nightly reprobe",
      candidateLimit: 2,
      recommendedEndpointId: null,
      candidates: [],
      recordedResultsCount: 0,
      failureMessage: null,
      attempts: 2,
      maxAttempts: 3,
      nextAttemptAt: null,
      leaseExpiresAt: "2026-07-07T10:00:31.000Z",
      leaseReclaimedCount: 0,
      deadLetteredAt: null,
      attemptAudit: [],
      appVersion: "1.2.3",
      results: [],
      workerId: "worker-1"
    };

    const queue = createRouteReprobeWorker({
      auth: () => ({
        id: "auth-1",
        userId: "user-1",
        provider: "credentials",
        status: "active",
        isAuthenticated: true,
        lastAuthenticatedAt: null,
        expiresAt: null
      }),
      resolveRouteDecision: async () => {
        throw new Error("boom");
      },
      recordRouteFeedback: async () => {
        throw new Error("recordRouteFeedback should not be called");
      },
      recordRouteWorkflowSnapshot: async () => {
        throw new Error("recordRouteWorkflowSnapshot should not be called");
      },
      enqueueJob: async () => {
        throw new Error("enqueueJob should not be called in runOnce test");
      },
      listJobs: async () => [],
      claimNextJob: async () => claimedJob,
      completeJob: async () => {
        throw new Error("completeJob should not be called for failed processing");
      },
      failJob: async (input) => {
        failedMessage = input.message;
      }
    });

    await expect(queue.runOnce()).resolves.toBe(true);
    expect(failedMessage).toBe("boom");
  });

  it("refreshes persisted ops alerts even when no job is claimed", async () => {
    let refreshCount = 0;

    const queue = createRouteReprobeWorker({
      auth: () => ({
        id: "auth-1",
        userId: "user-1",
        provider: "credentials",
        status: "active",
        isAuthenticated: true,
        lastAuthenticatedAt: null,
        expiresAt: null
      }),
      resolveRouteDecision: async () => ({
        routeContext: undefined,
        routeHealth,
        routePolicy
      }),
      recordRouteFeedback: async () => {
        throw new Error("recordRouteFeedback should not be called");
      },
      recordRouteWorkflowSnapshot: async () => {
        throw new Error("recordRouteWorkflowSnapshot should not be called");
      },
      refreshOpsAlerts: async () => {
        refreshCount += 1;
      },
      enqueueJob: async () => {
        throw new Error("enqueueJob should not be called in runOnce test");
      },
      listJobs: async () => [],
      claimNextJob: async () => null,
      completeJob: async () => {
        throw new Error("completeJob should not be called");
      },
      failJob: async () => {
        throw new Error("failJob should not be called");
      },
      opsAlertRefreshIntervalMs: 60_000
    });

    await expect(queue.runOnce()).resolves.toBe(false);
    expect(refreshCount).toBe(1);
  });
});

describe("computeRouteReprobeBackoffMs", () => {
  it("grows exponentially and clamps at five minutes", () => {
    expect(computeRouteReprobeBackoffMs(1)).toBe(15_000);
    expect(computeRouteReprobeBackoffMs(2)).toBe(30_000);
    expect(computeRouteReprobeBackoffMs(3)).toBe(60_000);
    expect(computeRouteReprobeBackoffMs(8)).toBe(300_000);
    expect(computeRouteReprobeBackoffMs(99)).toBe(300_000);
  });
});
