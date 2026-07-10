import { describe, expect, it } from "vitest";

import type { RouteReprobeJob } from "../../generated/prisma/client.js";
import { buildRouteDecisionOpsSummary } from "../route-decision-ops.js";
import { detectOpsAlertsFromSummary } from "../ops-alert-detector.js";

type OpsEvent = Parameters<typeof buildRouteDecisionOpsSummary>[0]["routeEvents"][number];

function createEvent(overrides: Partial<OpsEvent> & Pick<OpsEvent, "id" | "occurredAt" | "eventType" | "transportProfile">): OpsEvent {
  return {
    id: overrides.id,
    occurredAt: overrides.occurredAt,
    endpointId: overrides.endpointId ?? null,
    networkFingerprintId: overrides.networkFingerprintId ?? null,
    eventType: overrides.eventType,
    feedbackResult: overrides.feedbackResult ?? null,
    eventReason: overrides.eventReason ?? null,
    metadata: overrides.metadata ?? {},
    transportProfile: overrides.transportProfile,
    endpoint: overrides.endpoint ?? null,
    networkFingerprint: overrides.networkFingerprint ?? null
  };
}

const fingerprintWifi = {
  id: "fp-wifi",
  networkType: "wifi",
  carrier: "Carrier One",
  asn: 64500,
  countryCode: "PL",
  region: "Mazowieckie"
} as const;

const endpoints = {
  hetzner: {
    id: "ep-1",
    label: "Frankfurt Alpha",
    provider: "Hetzner",
    asn: 24940,
    transportProfile: "reality-tcp",
    city: "Frankfurt",
    countryCode: "DE",
    serverPool: {
      region: "Germany"
    }
  },
  leaseweb: {
    id: "ep-2",
    label: "Amsterdam Breeze",
    provider: "Leaseweb",
    asn: 16265,
    transportProfile: "tls-tcp",
    city: "Amsterdam",
    countryCode: "NL",
    serverPool: {
      region: "Netherlands"
    }
  },
  ovh: {
    id: "ep-3",
    label: "Warsaw Pulse",
    provider: "OVH",
    asn: 16276,
    transportProfile: "tcp-emergency",
    city: "Warsaw",
    countryCode: "PL",
    serverPool: {
      region: "Poland"
    }
  }
} as const;

function createRouteReprobeJob(
  overrides: Partial<RouteReprobeJob> & Pick<RouteReprobeJob, "id" | "status" | "createdAt" | "updatedAt">,
): RouteReprobeJob {
  return {
    id: overrides.id,
    status: overrides.status,
    context: overrides.context ?? {},
    note: overrides.note ?? null,
    appVersion: overrides.appVersion ?? null,
    candidateLimit: overrides.candidateLimit ?? 3,
    maxAttempts: overrides.maxAttempts ?? 3,
    results: overrides.results ?? [],
    recommendedEndpointId: overrides.recommendedEndpointId ?? null,
    candidates: overrides.candidates ?? [],
    recordedResultsCount: overrides.recordedResultsCount ?? 0,
    failureMessage: overrides.failureMessage ?? null,
    nextAttemptAt: overrides.nextAttemptAt ?? null,
    attempts: overrides.attempts ?? 0,
    leaseReclaimedCount: overrides.leaseReclaimedCount ?? 0,
    startedAt: overrides.startedAt ?? null,
    completedAt: overrides.completedAt ?? null,
    deadLetteredAt: overrides.deadLetteredAt ?? null,
    leaseExpiresAt: overrides.leaseExpiresAt ?? null,
    workerId: overrides.workerId ?? null,
    attemptAudit: overrides.attemptAudit ?? [],
    createdAt: overrides.createdAt,
    updatedAt: overrides.updatedAt,
  };
}

describe("buildRouteDecisionOpsSummary", () => {
  it("derives SLA, failure-domain pressure, and recovery metrics from the ops trail", () => {
    const summary = buildRouteDecisionOpsSummary({
      windowHours: 6,
      recentLimit: 12,
      summaryLimit: 6,
      now: new Date("2026-07-07T12:30:00.000Z"),
      routeReprobeJobs: [
        createRouteReprobeJob({
          id: "job-completed",
          status: "completed",
          createdAt: new Date("2026-07-07T10:40:00.000Z"),
          startedAt: new Date("2026-07-07T10:45:00.000Z"),
          completedAt: new Date("2026-07-07T11:05:00.000Z"),
          attempts: 1,
          recordedResultsCount: 1,
          updatedAt: new Date("2026-07-07T11:05:00.000Z"),
          attemptAudit: [
            { attempt: 0, event: "queued", at: "2026-07-07T10:40:00.000Z", workerId: null, message: null, nextAttemptAt: "2026-07-07T10:40:00.000Z" },
            { attempt: 1, event: "claimed", at: "2026-07-07T10:45:00.000Z", workerId: "worker-1", message: null, nextAttemptAt: null },
            { attempt: 1, event: "completed", at: "2026-07-07T11:05:00.000Z", workerId: "worker-1", message: null, nextAttemptAt: null },
          ],
        }),
        createRouteReprobeJob({
          id: "job-dead",
          status: "dead_letter",
          createdAt: new Date("2026-07-07T11:00:00.000Z"),
          startedAt: new Date("2026-07-07T11:10:00.000Z"),
          completedAt: new Date("2026-07-07T11:40:00.000Z"),
          deadLetteredAt: new Date("2026-07-07T11:40:00.000Z"),
          attempts: 3,
          maxAttempts: 3,
          leaseReclaimedCount: 1,
          failureMessage: "boom",
          updatedAt: new Date("2026-07-07T11:40:00.000Z"),
          attemptAudit: [
            { attempt: 0, event: "queued", at: "2026-07-07T11:00:00.000Z", workerId: null, message: null, nextAttemptAt: "2026-07-07T11:00:00.000Z" },
            { attempt: 1, event: "claimed", at: "2026-07-07T11:10:00.000Z", workerId: "worker-2", message: null, nextAttemptAt: null },
            { attempt: 1, event: "failed", at: "2026-07-07T11:20:00.000Z", workerId: "worker-2", message: "boom", nextAttemptAt: null },
            { attempt: 1, event: "retry_scheduled", at: "2026-07-07T11:20:00.000Z", workerId: "worker-2", message: "boom", nextAttemptAt: "2026-07-07T11:25:00.000Z" },
            { attempt: 2, event: "claimed", at: "2026-07-07T11:26:00.000Z", workerId: "worker-2", message: null, nextAttemptAt: null },
            { attempt: 2, event: "lease_reclaimed", at: "2026-07-07T11:32:00.000Z", workerId: "worker-2", message: "stale", nextAttemptAt: null },
            { attempt: 3, event: "claimed", at: "2026-07-07T11:33:00.000Z", workerId: "worker-3", message: "reclaimed", nextAttemptAt: null },
            { attempt: 3, event: "failed", at: "2026-07-07T11:40:00.000Z", workerId: "worker-3", message: "boom", nextAttemptAt: null },
            { attempt: 3, event: "dead_lettered", at: "2026-07-07T11:40:00.000Z", workerId: "worker-3", message: "boom", nextAttemptAt: null },
          ],
        }),
        createRouteReprobeJob({
          id: "job-queued",
          status: "queued",
          createdAt: new Date("2026-07-07T12:00:00.000Z"),
          context: {
            networkType: "wifi",
            carrier: "Carrier One",
            asn: 64500,
            countryCode: "PL",
            region: "Mazowieckie"
          },
          nextAttemptAt: new Date("2026-07-07T12:05:00.000Z"),
          attempts: 1,
          updatedAt: new Date("2026-07-07T12:05:00.000Z"),
          attemptAudit: [
            { attempt: 0, event: "queued", at: "2026-07-07T12:00:00.000Z", workerId: null, message: null, nextAttemptAt: "2026-07-07T12:00:00.000Z" },
            { attempt: 1, event: "failed", at: "2026-07-07T12:04:00.000Z", workerId: "worker-4", message: "timeout", nextAttemptAt: null },
            { attempt: 1, event: "retry_scheduled", at: "2026-07-07T12:05:00.000Z", workerId: "worker-4", message: "timeout", nextAttemptAt: "2026-07-07T12:05:00.000Z" },
          ],
        }),
      ],
      routeEvents: [
        createEvent({
          id: "feedback-1",
          occurredAt: new Date("2026-07-07T10:00:00.000Z"),
          eventType: "route_feedback",
          transportProfile: "reality-tcp",
          endpointId: "ep-1",
          networkFingerprintId: "fp-wifi",
          feedbackResult: "failed",
          eventReason: "timeout",
          endpoint: endpoints.hetzner,
          networkFingerprint: fingerprintWifi
        }),
        createEvent({
          id: "feedback-2",
          occurredAt: new Date("2026-07-07T10:20:00.000Z"),
          eventType: "route_feedback",
          transportProfile: "reality-tcp",
          endpointId: "ep-1",
          networkFingerprintId: "fp-wifi",
          feedbackResult: "unstable",
          eventReason: "packet_loss_suspected",
          endpoint: endpoints.hetzner,
          networkFingerprint: fingerprintWifi
        }),
        createEvent({
          id: "resolve-1",
          occurredAt: new Date("2026-07-07T10:45:00.000Z"),
          eventType: "runtime_reprobe_resolve",
          transportProfile: "background_resolve",
          endpointId: "ep-2",
          metadata: {
            recommendedReason: "provider_diversity_fallback"
          },
          endpoint: endpoints.leaseweb,
          networkFingerprint: fingerprintWifi
        }),
        createEvent({
          id: "feedback-3",
          occurredAt: new Date("2026-07-07T11:05:00.000Z"),
          eventType: "route_feedback",
          transportProfile: "reality-tcp",
          endpointId: "ep-1",
          networkFingerprintId: "fp-wifi",
          feedbackResult: "connected",
          endpoint: endpoints.hetzner,
          networkFingerprint: fingerprintWifi
        }),
        createEvent({
          id: "feedback-4",
          occurredAt: new Date("2026-07-07T11:15:00.000Z"),
          eventType: "route_feedback",
          transportProfile: "tcp-emergency",
          endpointId: "ep-3",
          networkFingerprintId: "fp-wifi",
          feedbackResult: "failed",
          eventReason: "dns_blocked",
          endpoint: endpoints.ovh,
          networkFingerprint: fingerprintWifi
        }),
        createEvent({
          id: "resolve-2",
          occurredAt: new Date("2026-07-07T11:20:00.000Z"),
          eventType: "runtime_reprobe_resolve",
          transportProfile: "background_resolve",
          endpointId: "ep-3",
          metadata: {
            recommendedReason: "asn_diversity_fallback"
          },
          endpoint: endpoints.ovh,
          networkFingerprint: fingerprintWifi
        }),
        createEvent({
          id: "feedback-5",
          occurredAt: new Date("2026-07-07T11:30:00.000Z"),
          eventType: "route_feedback",
          transportProfile: "tls-tcp",
          endpointId: "ep-2",
          networkFingerprintId: "fp-wifi",
          feedbackResult: "connected",
          endpoint: endpoints.leaseweb,
          networkFingerprint: fingerprintWifi
        }),
        createEvent({
          id: "feedback-6",
          occurredAt: new Date("2026-07-07T12:10:00.000Z"),
          eventType: "route_feedback",
          transportProfile: "tls-tcp",
          endpointId: "ep-2",
          networkFingerprintId: "fp-wifi",
          feedbackResult: "connected",
          endpoint: endpoints.leaseweb,
          networkFingerprint: fingerprintWifi
        })
      ]
    });

    expect(summary.qualityMetrics.slaWindows.total).toBe(3);
    expect(summary.qualityMetrics.slaWindows.healthy).toBe(1);
    expect(summary.qualityMetrics.slaWindows.breached).toBe(2);
    expect(summary.qualityMetrics.slaWindows.currentHealthyStreak).toBe(1);
    expect(summary.qualityMetrics.slaWindows.lastBreachAt).toBe("2026-07-07T11:00:00.000Z");

    const leasewebPressure = summary.qualityMetrics.providerPressure.find((item) => item.domainKey === "Leaseweb");
    expect(leasewebPressure).toMatchObject({
      fallbackCount: 1,
      observationCount: 1,
      affectedEndpoints: 1
    });

    const ovhAsnPressure = summary.qualityMetrics.asnPressure.find((item) => item.domainKey === "16276");
    expect(ovhAsnPressure).toMatchObject({
      fallbackCount: 1,
      observationCount: 1
    });

    const hetznerRecovery = summary.qualityMetrics.recoveryByFailureDomain.find(
      (item) => item.domainType === "provider" && item.domainKey === "Hetzner"
    );
    expect(hetznerRecovery).toMatchObject({
      resolvedWindows: 1,
      activeWindows: 0,
      averageRecoveryMinutes: 65,
      medianRecoveryMinutes: 65
    });

    const ovhRecovery = summary.qualityMetrics.recoveryByFailureDomain.find(
      (item) => item.domainType === "provider" && item.domainKey === "OVH"
    );
    expect(ovhRecovery).toMatchObject({
      resolvedWindows: 0,
      activeWindows: 1
    });
    expect(summary.qualityMetrics.executionImpact).toMatchObject({
      attentionLevel: "watch",
      lastSuccessfulCompletionAt: "2026-07-07T11:05:00.000Z",
      minutesSinceLastSuccessfulCompletion: 85,
      qualityEventsSinceLastSuccessfulCompletion: 3,
      fallbackResolvesSinceLastSuccessfulCompletion: 1,
      degradationStartsSinceLastSuccessfulCompletion: 1,
      activeDegradedNetworks: 1,
      queuedOrRunningJobsOnActiveDegradedNetworks: 1,
      deadLetterJobsOnActiveDegradedNetworks: 0
    });
    expect(summary.operationalSummary).toMatchObject({
      overallSeverity: "critical",
      activeAlertCount: 4,
      inventoryHealth: {
        riskLevel: "ok",
        activeEndpoints: 3,
        distinctProviders: 3,
        distinctAsns: 3,
        distinctPools: 3,
        distinctRegions: 3,
        largestRegionalDomainSize: 1,
        minimumRecommendedFailureDomains: 2,
        failedDimensions: [],
        policyViolationMessage: null,
      },
      retention: {
        probeReportsDays: 45,
        routeEventsDays: 45,
        routeReprobeJobsDays: 14,
        routeSuccessRollupsDays: 180,
        routeRankingsDays: 180
      }
    });
    expect(summary.operationalSummary.alerts.map((alert) => alert.id)).toEqual([
      "dead-letter-jobs",
      "overdue-queued-jobs",
      "quality-signal-backlog",
      "sla-breaches",
    ]);
    expect(detectOpsAlertsFromSummary(summary).map((alert) => alert.id)).toEqual(
      summary.operationalSummary.alerts.map((alert) => alert.id)
    );
    expect(summary.operationalSummary.history).toHaveLength(3);
    expect(summary.operationalSummary.history[0]).toMatchObject({
      startedAt: "2026-07-07T10:00:00.000Z",
      severity: "watch",
      feedbackEvents: 2,
      connectedCount: 0,
      unstableCount: 1,
      failedCount: 1,
      fallbackResolves: 1,
      queuedJobs: 1,
      completedJobs: 0,
      deadLetterJobs: 0,
    });
    expect(summary.operationalSummary.history[2]).toMatchObject({
      startedAt: "2026-07-07T12:00:00.000Z",
      severity: "watch",
      feedbackEvents: 1,
      connectedCount: 1,
      queuedJobs: 1,
      completedJobs: 0,
      deadLetterJobs: 0,
    });
    expect(summary.operationalSummary.dailyHistory).toHaveLength(1);
    expect(summary.operationalSummary.dailyHistory[0]).toMatchObject({
      startedAt: "2026-07-07T00:00:00.000Z",
      severity: "critical",
      hourlyWindows: 3,
      feedbackEvents: 6,
      connectedCount: 3,
      unstableCount: 1,
      failedCount: 2,
      fallbackResolves: 2,
      queuedJobs: 3,
      completedJobs: 2,
      deadLetterJobs: 1,
    });

    expect(summary.routeReprobeExecution.totals).toMatchObject({
      totalJobs: 3,
      queuedJobs: 1,
      runningJobs: 0,
      completedJobs: 1,
      deadLetterJobs: 1,
      retryScheduledCount: 2,
      leaseReclaimedCount: 1,
      overdueQueuedJobs: 1,
      staleRunningJobs: 0,
    });
    expect(summary.routeReprobeExecution.workerHealth).toMatchObject({
      activeWorkerCount: 0,
      latestWorkerActivityAt: "2026-07-07T12:05:00.000Z",
      lastClaimedAt: "2026-07-07T11:33:00.000Z",
      lastCompletedAt: "2026-07-07T11:05:00.000Z",
    });
    expect(summary.routeReprobeExecution.timing).toMatchObject({
      averageTimeToStartMinutes: 7.5,
      medianTimeToStartMinutes: 7.5,
      p95TimeToStartMinutes: 10,
      oldestQueuedAgeMinutes: 30,
    });
    const boomFailure = summary.routeReprobeExecution.failureDrilldown.find((item) => item.failureKey === "boom");
    expect(boomFailure).toMatchObject({
      failureKey: "boom",
      affectedJobs: 1,
      deadLetterJobs: 1,
      retryScheduledCount: 1,
      failedEventCount: 2,
      leaseReclaimedCount: 0,
      sampleJobIds: ["job-dead"],
    });
    const reclaimedFailure = summary.routeReprobeExecution.failureDrilldown.find(
      (item) => item.failureKey === "lease_expired_before_completion"
    );
    expect(reclaimedFailure).toMatchObject({
      failureKey: "lease_expired_before_completion",
      affectedJobs: 1,
      deadLetterJobs: 0,
      retryScheduledCount: 0,
      failedEventCount: 0,
      leaseReclaimedCount: 1,
      sampleJobIds: ["job-dead"],
    });
    expect(summary.routeReprobeExecution.timeline[0]).toMatchObject({
      jobId: "job-queued",
      event: "retry_scheduled",
      attempt: 1,
      message: "timeout",
      network: {
        networkType: "wifi",
        carrier: "Carrier One",
        asn: 64500,
      },
    });
    expect(summary.routeReprobeExecution.recentJobs[0]).toMatchObject({
      id: "job-queued",
      latestAttemptEvent: "retry_scheduled",
      timeToStartMinutes: null,
      lifecycleMinutes: 30,
      qualityImpact: {
        feedbackEventsOnJobNetwork: 1,
        connectedCountOnJobNetwork: 1,
        unstableCountOnJobNetwork: 0,
        failedCountOnJobNetwork: 0,
        fallbackResolvesOnJobNetwork: 0,
        degradationStartsOnJobNetwork: 0,
        activeDegradationOnJobNetwork: true,
        dominantFailureReasonOnJobNetwork: null,
        latestQualityEventAt: "2026-07-07T12:10:00.000Z",
      },
    });
    expect(summary.routeReprobeExecution.workerAlerts.map((alert) => alert.id)).toEqual([
      "worker-dead-letter:worker-3",
      "worker-retries:worker-4",
      "worker-stale:worker-2",
    ]);
    expect(summary.routeReprobeExecution.workerHotspots[0]).toMatchObject({
      workerId: "worker-3",
      claimedJobs: 1,
      completedJobs: 0,
      deadLetterJobs: 1,
      retryScheduledCount: 0,
      failedEventCount: 1,
      leaseReclaimedCount: 0,
      staleRunningJobs: 0,
      latestActivityAt: "2026-07-07T11:40:00.000Z",
      sampleJobIds: ["job-dead"],
      failureKeys: ["boom"],
    });
    const workerTwo = summary.routeReprobeExecution.workerHotspots.find((item) => item.workerId === "worker-2");
    expect(workerTwo).toMatchObject({
      claimedJobs: 2,
      retryScheduledCount: 1,
      failedEventCount: 1,
      leaseReclaimedCount: 1,
      sampleJobIds: ["job-dead"],
    });
    const wifiHotspot = summary.routeReprobeExecution.networkHotspots.find(
      (item) => item.network.networkType === "wifi" && item.network.asn === 64500
    );
    expect(wifiHotspot).toMatchObject({
      network: {
        networkType: "wifi",
        carrier: "Carrier One",
        asn: 64500,
      },
      totalJobs: 1,
      queuedJobs: 1,
      completedJobs: 0,
      deadLetterJobs: 0,
      activeDegradation: true,
      activeDegradationMinutes: 75,
      feedbackEvents: 6,
      connectedCount: 3,
      unstableCount: 1,
      failedCount: 2,
      fallbackResolves: 2,
      latestJobAt: "2026-07-07T12:00:00.000Z",
      latestQualityEventAt: "2026-07-07T12:10:00.000Z",
      dominantFailureReason: "timeout",
      sampleJobIds: ["job-queued"],
    });
    expect(summary.routeReprobeExecution.focusedDrilldowns.worker).toMatchObject({
      workerId: "worker-3",
      activeAlertCount: 1,
      deadLetterJobs: 1,
      sampleJobIds: ["job-dead"],
    });
    expect(summary.routeReprobeExecution.focusedDrilldowns.worker?.recentTimeline[0]).toMatchObject({
      workerId: "worker-3",
      event: "failed",
      jobId: "job-dead",
    });
    expect(summary.routeReprobeExecution.focusedDrilldowns.network).toMatchObject({
      networkKey: "wifi:Carrier One:64500:PL:Mazowieckie",
      queuedOrRunningJobs: 1,
      deadLetterJobs: 0,
      activeDegradation: true,
      dominantFailureReason: "timeout",
    });
    expect(summary.routeReprobeExecution.focusedDrilldowns.network?.relatedJobs[0]).toMatchObject({
      id: "job-queued",
      status: "queued",
    });
    expect(summary.routeReprobeExecution.focusedDrilldowns.job).toMatchObject({
      job: {
        id: "job-dead",
        status: "dead_letter",
      },
      relatedWorkerIds: ["worker-2", "worker-3"],
    });
    expect(summary.routeReprobeExecution.focusedDrilldowns.job?.attemptTrail[0]).toMatchObject({
      jobId: "job-dead",
      event: "failed",
    });
  });

  it("raises an explainable alert when server inventory is not diverse enough", () => {
    const summary = buildRouteDecisionOpsSummary({
      windowHours: 6,
      recentLimit: 12,
      summaryLimit: 6,
      now: new Date("2026-07-07T12:30:00.000Z"),
      routeEvents: [],
      routeReprobeJobs: [],
      endpointInventory: [
        {
          endpointId: "ep-1",
          provider: "Hetzner",
          asn: 24940,
          poolCode: "fra-a",
          countryCode: "DE",
          region: "Germany",
        },
      ],
    });

    expect(summary.operationalSummary.inventoryHealth).toMatchObject({
      riskLevel: "critical",
      activeEndpoints: 1,
      distinctProviders: 1,
      distinctAsns: 1,
      distinctPools: 1,
      distinctRegions: 1,
      largestRegionalDomainSize: 1,
      minimumRecommendedFailureDomains: 2,
      failedDimensions: ["active endpoints 1/2", "providers 1/2", "ASNs 1/2", "regions 1/2"],
      policyViolationMessage:
        "Active inventory must keep at least 2 independent failure domains across provider/ASN/region; got active endpoints 1/2, providers 1/2, ASNs 1/2, regions 1/2.",
    });
    expect(detectOpsAlertsFromSummary(summary)).toContainEqual(
      expect.objectContaining({
        id: "inventory-failure-domain-risk",
        detail:
          "Active inventory must keep at least 2 independent failure domains across provider/ASN/region; got active endpoints 1/2, providers 1/2, ASNs 1/2, regions 1/2."
      })
    );
  });
});
