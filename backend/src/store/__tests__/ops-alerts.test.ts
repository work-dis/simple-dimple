import { describe, expect, it } from "vitest";

import { ContactType, OpsAlertStatus, UserStatus } from "../../generated/prisma/client.js";
import type { RouteDecisionOpsSummary } from "../../types.js";
import { buildOpsAlertEscalationPreview, createOpsAlertStore } from "../ops-alerts.js";
import type { OpsAlertDeliveryTransport } from "../ops-alert-delivery.js";

const recipients = [
  {
    id: "admin-1",
    displayName: "Alice Ops",
    contact: "@alice_ops",
    contactType: "telegram" as const,
    opsAlertImmediateEnabled: true,
    opsAlertDigestEnabled: true,
    opsAlertEscalationTier: "primary" as const
  },
  {
    id: "admin-2",
    displayName: "Bob SRE",
    contact: "bob@example.com",
    contactType: "email" as const,
    opsAlertImmediateEnabled: true,
    opsAlertDigestEnabled: true,
    opsAlertEscalationTier: "secondary" as const
  }
];

type StoredAlert = {
  id: string;
  alertType: string;
  severity: "watch" | "critical";
  status: OpsAlertStatus;
  dedupeKey: string;
  title: string;
  detail: string;
  metadata: unknown;
  startedAt: Date;
  lastDetectedAt: Date;
  acknowledgedAt: Date | null;
  resolvedAt: Date | null;
  snoozedUntil: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type StoredDelivery = {
  id: string;
  opsAlertId: string;
  batchId: string;
  channel: ContactType;
  escalationLevel: string;
  status: "delivered" | "failed";
  recipientUserId: string | null;
  recipientDisplayName: string;
  recipientContact: string;
  subject: string;
  message: string;
  reason: string;
  deliveryPath: string;
  providerMessageId: string | null;
  actorUserId: string | null;
  deliveredAt: Date | null;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
};

function createOpsSummary(overrides?: Partial<RouteDecisionOpsSummary>): RouteDecisionOpsSummary {
  return {
    windowHours: 72,
    generatedAt: "2026-07-07T18:30:00.000Z",
    totals: {
      feedbackEvents: 0,
      connectedCount: 0,
      unstableCount: 0,
      failedCount: 0,
      successRate: 0,
      uniqueEndpoints: 0,
      uniqueNetworks: 0
    },
    operationalSummary: {
      overallSeverity: "ok",
      activeAlertCount: 0,
      alerts: [],
      inventoryHealth: {
        riskLevel: "ok",
        activeEndpoints: 3,
        distinctProviders: 3,
        distinctAsns: 3,
        distinctPools: 3,
        distinctRegions: 3,
        largestRegionalDomainSize: 1,
        minimumRecommendedFailureDomains: 3,
        failedDimensions: [],
        policyViolationMessage: null
      },
      retention: {
        probeReportsDays: 45,
        routeEventsDays: 45,
        routeReprobeJobsDays: 14,
        routeSuccessRollupsDays: 180,
        routeRankingsDays: 180
      },
      history: [],
      dailyHistory: []
    },
    qualityMetrics: {
      fallbackPressure: {
        observationCount: 0,
        fallbackCount: 0,
        fallbackRate: 0,
        dominantFallbackReason: null,
        lastTriggeredAt: null
      },
      degradationWindows: {
        total: 0,
        active: 0,
        resolved: 0,
        affectedEndpoints: 0,
        affectedNetworks: 0,
        longestActiveMinutes: null,
        lastStartedAt: null
      },
      recoveryTime: {
        resolvedWindowCount: 0,
        averageMinutes: null,
        medianMinutes: null,
        lastRecoveredAt: null
      },
      slaWindows: {
        windowSizeMinutes: 60,
        availabilityTarget: 0.95,
        total: 0,
        healthy: 0,
        breached: 0,
        breachRate: 0,
        currentHealthyStreak: 0,
        lastBreachAt: null
      },
      executionImpact: {
        attentionLevel: "stable",
        lastSuccessfulCompletionAt: null,
        minutesSinceLastSuccessfulCompletion: null,
        qualityEventsSinceLastSuccessfulCompletion: 0,
        fallbackResolvesSinceLastSuccessfulCompletion: 0,
        degradationStartsSinceLastSuccessfulCompletion: 0,
        activeDegradedNetworks: 0,
        queuedOrRunningJobsOnActiveDegradedNetworks: 0,
        deadLetterJobsOnActiveDegradedNetworks: 0
      },
      providerPressure: [],
      asnPressure: [],
      recoveryByFailureDomain: []
    },
    endpoints: [],
    networks: [],
    recentEvents: [],
    routeReprobeExecution: {
      totals: {
        totalJobs: 0,
        queuedJobs: 0,
        runningJobs: 0,
        completedJobs: 0,
        deadLetterJobs: 0,
        retryScheduledCount: 0,
        leaseReclaimedCount: 0,
        overdueQueuedJobs: 0,
        staleRunningJobs: 0,
        completionRate: 0,
        deadLetterRate: 0,
        retryRate: 0
      },
      timing: {
        averageTimeToStartMinutes: null,
        medianTimeToStartMinutes: null,
        p95TimeToStartMinutes: null,
        averageLifecycleMinutes: null,
        medianLifecycleMinutes: null,
        p95LifecycleMinutes: null,
        oldestQueuedAgeMinutes: null,
        longestRunningAgeMinutes: null
      },
      workerHealth: {
        activeWorkerCount: 0,
        latestWorkerActivityAt: null,
        lastClaimedAt: null,
        lastCompletedAt: null
      },
      recentJobs: [],
      failureDrilldown: [],
      workerHotspots: [],
      networkHotspots: [],
      workerAlerts: [],
      timeline: [],
      focusedDrilldowns: {
        worker: null,
        network: null,
        job: null
      }
    },
    ...overrides
  };
}

function createPrismaStub(
  initialAlerts: StoredAlert[] = [],
  initialDeliveries: StoredDelivery[] = [],
  adminUserOverrides?: Array<{
    id: string;
    displayName: string;
    contact: string;
    contactType: ContactType;
    opsAlertImmediateEnabled: boolean;
    opsAlertDigestEnabled: boolean;
    opsAlertEscalationTier: "primary" | "secondary";
    status: UserStatus;
    memberSince: Date;
  }>
) {
  const alerts = [...initialAlerts];
  const deliveries = [...initialDeliveries];
  const adminUsers = adminUserOverrides ?? [
    {
      id: "admin-1",
      displayName: "Alice Ops",
      contact: "@alice_ops",
      contactType: ContactType.telegram,
      opsAlertImmediateEnabled: true,
      opsAlertDigestEnabled: true,
      opsAlertEscalationTier: "primary",
      status: UserStatus.active,
      memberSince: new Date("2026-07-01T00:00:00.000Z")
    },
    {
      id: "admin-2",
      displayName: "Bob SRE",
      contact: "bob@example.com",
      contactType: ContactType.email,
      opsAlertImmediateEnabled: true,
      opsAlertDigestEnabled: true,
      opsAlertEscalationTier: "secondary",
      status: UserStatus.active,
      memberSince: new Date("2026-07-02T00:00:00.000Z")
    }
  ];

  const prisma: any = {
    opsAlert: {
      async findUnique(args: { where: { dedupeKey?: string; id?: string } }) {
        if (args.where.dedupeKey) {
          return alerts.find((alert) => alert.dedupeKey === args.where.dedupeKey) ?? null;
        }

        if (args.where.id) {
          return alerts.find((alert) => alert.id === args.where.id) ?? null;
        }

        return null;
      },
      async create(args: { data: Omit<StoredAlert, "createdAt" | "updatedAt"> & { id: string } }) {
        const createdAt = new Date();
        const alert: StoredAlert = {
          ...args.data,
          createdAt,
          updatedAt: createdAt
        };
        alerts.push(alert);
        return alert;
      },
      async update(args: { where: { id: string }; data: Partial<StoredAlert> }) {
        const index = alerts.findIndex((alert) => alert.id === args.where.id);
        if (index === -1) {
          throw new Error("Ops alert not found");
        }

        alerts[index] = {
          ...alerts[index],
          ...args.data,
          updatedAt: new Date()
        };

        return alerts[index];
      },
      async findMany(args?: {
        where?: {
          dedupeKey?: { notIn?: string[] };
          id?: { in?: string[] };
          status?: OpsAlertStatus | { in?: OpsAlertStatus[]; not?: OpsAlertStatus };
          severity?: "watch" | "critical";
        };
        orderBy?: Array<{ lastDetectedAt?: "desc" | "asc"; updatedAt?: "desc" | "asc" }>;
        take?: number;
        select?: { id: true };
      }) {
        let results = [...alerts];
        const where = args?.where;

        if (where?.dedupeKey?.notIn) {
          results = results.filter((alert) => !where.dedupeKey?.notIn?.includes(alert.dedupeKey));
        }

        if (where?.id?.in) {
          results = results.filter((alert) => where.id?.in?.includes(alert.id));
        }

        const statusFilter = where?.status;
        if (typeof statusFilter === "string") {
          results = results.filter((alert) => alert.status === statusFilter);
        } else if (statusFilter && typeof statusFilter === "object" && Array.isArray(statusFilter.in)) {
          results = results.filter((alert) => statusFilter.in?.includes(alert.status));
        } else if (statusFilter && typeof statusFilter === "object" && statusFilter.not) {
          results = results.filter((alert) => alert.status !== statusFilter.not);
        }

        if (where?.severity) {
          results = results.filter((alert) => alert.severity === where.severity);
        }

        results.sort((left, right) => {
          const lastDetectedDiff = right.lastDetectedAt.getTime() - left.lastDetectedAt.getTime();
          if (lastDetectedDiff !== 0) {
            return lastDetectedDiff;
          }

          return right.updatedAt.getTime() - left.updatedAt.getTime();
        });

        if (args?.take) {
          results = results.slice(0, args.take);
        }

        if (args?.select?.id) {
          return results.map((alert) => ({ id: alert.id }));
        }

        return results;
      },
      async updateMany(args: { where: { id: { in: string[] } }; data: Partial<StoredAlert> }) {
        let count = 0;
        for (const alert of alerts) {
          if (!args.where.id.in.includes(alert.id)) {
            continue;
          }

          Object.assign(alert, args.data, { updatedAt: new Date() });
          count += 1;
        }

        return { count };
      }
    },
    opsAlertDelivery: {
      async findUnique(args: { where: { id: string } }) {
        return deliveries.find((delivery) => delivery.id === args.where.id) ?? null;
      },
      async create(args: { data: Omit<StoredDelivery, "createdAt" | "updatedAt"> & { id: string } }) {
        const createdAt = new Date();
        const delivery: StoredDelivery = {
          ...args.data,
          createdAt,
          updatedAt: createdAt
        };
        deliveries.push(delivery);
        return delivery;
      },
      async findMany(args?: {
        where?: {
          opsAlertId?: string | { in?: string[] };
          batchId?: string;
          channel?: ContactType;
          recipientContact?: string;
          escalationLevel?: string;
          status?: "delivered" | "failed";
          createdAt?: { gte?: Date };
        };
        orderBy?: Array<{ createdAt?: "desc" | "asc" }>;
        take?: number;
      }) {
        let results = [...deliveries];

        if (typeof args?.where?.opsAlertId === "string") {
          results = results.filter((delivery) => delivery.opsAlertId === args.where?.opsAlertId);
        }

        const opsAlertIdFilter = args?.where?.opsAlertId;
        if (opsAlertIdFilter && typeof opsAlertIdFilter === "object" && Array.isArray(opsAlertIdFilter.in)) {
          const alertIds = opsAlertIdFilter.in;
          results = results.filter((delivery) => alertIds.includes(delivery.opsAlertId));
        }

        if (args?.where?.batchId) {
          results = results.filter((delivery) => delivery.batchId === args.where?.batchId);
        }

        if (args?.where?.channel) {
          results = results.filter((delivery) => delivery.channel === args.where?.channel);
        }

        if (args?.where?.recipientContact) {
          results = results.filter((delivery) => delivery.recipientContact === args.where?.recipientContact);
        }

        if (args?.where?.escalationLevel) {
          results = results.filter((delivery) => delivery.escalationLevel === args.where?.escalationLevel);
        }

        if (args?.where?.status) {
          results = results.filter((delivery) => delivery.status === args.where?.status);
        }

        const createdAtGte = args?.where?.createdAt?.gte;
        if (createdAtGte) {
          results = results.filter((delivery) => delivery.createdAt >= createdAtGte);
        }

        const createdAtOrder = args?.orderBy?.[0]?.createdAt ?? "desc";
        results.sort((left, right) =>
          createdAtOrder === "asc"
            ? left.createdAt.getTime() - right.createdAt.getTime()
            : right.createdAt.getTime() - left.createdAt.getTime()
        );

        if (args?.take) {
          results = results.slice(0, args.take);
        }

        return results;
      }
    },
    user: {
      async findMany() {
        return adminUsers;
      }
    },
    async $transaction<T>(callback: (tx: typeof prisma) => Promise<T>) {
      return callback(prisma);
    }
  };

  return {
    prisma,
    alerts,
    deliveries
  };
}

function createDeliveryTransportStub(
  overrides?: Partial<Record<"telegram" | "email", Awaited<ReturnType<OpsAlertDeliveryTransport["deliver"]>>>>
): OpsAlertDeliveryTransport & { calls: Array<{ channel: "telegram" | "email"; subject: string; message: string }> } {
  const calls: Array<{ channel: "telegram" | "email"; subject: string; message: string }> = [];

  return {
    calls,
    async deliver(input) {
      calls.push({
        channel: input.channel,
        subject: input.subject,
        message: input.message
      });
      const next = overrides?.[input.channel];
      if (next) {
        return next;
      }

      return {
        status: "delivered",
        deliveryPath: "local_dev_outbox",
        providerMessageId: `local-dev:${input.batchId}:${input.recipientContact}:${input.channel}`,
        deliveredAt: new Date("2026-07-08T00:00:00.000Z"),
        metadata: {
          provider: "local_dev_outbox"
        }
      };
    }
  };
}

describe("buildOpsAlertEscalationPreview", () => {
  it("escalates active critical alerts immediately to active admin contacts", () => {
    const preview = buildOpsAlertEscalationPreview({
      alert: {
        id: "alert-1",
        status: "active",
        severity: "critical",
        title: "Dead-letter jobs present",
        detail: "2 reprobe jobs reached dead-letter.",
        lastDetectedAt: "2026-07-07T18:30:00.000Z",
        metadata: {}
      },
      recipients,
      now: new Date("2026-07-07T18:45:00.000Z")
    });

    expect(preview.escalationLevel).toBe("immediate");
    expect(preview.shouldEscalate).toBe(true);
    expect(preview.recipients).toHaveLength(2);
    expect(preview.recipients.map((recipient) => recipient.channel)).toEqual(["telegram", "email"]);
    expect(preview.recipients.map((recipient) => recipient.chainStep)).toEqual([1, 2]);
  });

  it("keeps acknowledged alerts inside the current triage flow", () => {
    const preview = buildOpsAlertEscalationPreview({
      alert: {
        id: "alert-2",
        status: "acknowledged",
        severity: "critical",
        title: "Stale running jobs detected",
        detail: "1 running job exceeded lease window.",
        lastDetectedAt: "2026-07-07T18:30:00.000Z",
        metadata: {}
      },
      recipients,
      now: new Date("2026-07-07T18:45:00.000Z")
    });

    expect(preview.escalationLevel).toBe("none");
    expect(preview.shouldEscalate).toBe(false);
    expect(preview.recipients).toEqual([]);
  });

  it("includes inventory diagnosis in escalation message for inventory alerts", () => {
    const preview = buildOpsAlertEscalationPreview({
      alert: {
        id: "alert-3",
        status: "active",
        severity: "watch",
        title: "Server inventory is not diverse enough",
        detail:
          "Active inventory must keep at least 3 independent failure domains across provider/ASN/region; got active endpoints 2/3, providers 2/3, ASNs 2/3, regions 2/3.",
        lastDetectedAt: "2026-07-07T18:30:00.000Z",
        metadata: {
          source: "route_decision_ops_summary",
          inventoryFailedDimensions: ["active endpoints 2/3", "providers 2/3", "ASNs 2/3", "regions 2/3"],
          inventoryPolicyViolationMessage:
            "Active inventory must keep at least 3 independent failure domains across provider/ASN/region; got active endpoints 2/3, providers 2/3, ASNs 2/3, regions 2/3.",
          activeInventoryEndpoints: 2,
          distinctInventoryProviders: 2,
          distinctInventoryAsns: 2,
          distinctInventoryRegions: 2,
          minimumRecommendedFailureDomains: 3
        }
      },
      recipients,
      now: new Date("2026-07-07T18:45:00.000Z")
    });

    expect(preview.escalationLevel).toBe("digest");
    expect(preview.recommendedMessage).toContain("Failed dimensions: active endpoints 2/3, providers 2/3, ASNs 2/3, regions 2/3");
    expect(preview.recommendedMessage).toContain("Inventory counts: endpoints 2, providers 2, ASNs 2, regions 2");
    expect(preview.recommendedMessage).toContain("Policy target: 3 independent failure domains");
    expect(preview.recipients.map((recipient) => recipient.chainStep)).toEqual([1, 2]);
  });
});

describe("createOpsAlertStore", () => {
  it("materializes detected alerts into the persisted feed", async () => {
    const { prisma, alerts } = createPrismaStub();
    const store = createOpsAlertStore(prisma as never, {
      getRouteDecisionOpsSummary: async () =>
        createOpsSummary({
          generatedAt: "2026-07-07T19:00:00.000Z",
          operationalSummary: {
            overallSeverity: "critical",
            activeAlertCount: 1,
            alerts: [],
            inventoryHealth: {
              riskLevel: "ok",
              activeEndpoints: 3,
              distinctProviders: 3,
              distinctAsns: 3,
              distinctPools: 3,
              distinctRegions: 3,
              largestRegionalDomainSize: 1,
              minimumRecommendedFailureDomains: 3,
              failedDimensions: [],
              policyViolationMessage: null
            },
            retention: {
              probeReportsDays: 45,
              routeEventsDays: 45,
              routeReprobeJobsDays: 14,
              routeSuccessRollupsDays: 180,
              routeRankingsDays: 180
            },
            history: [],
            dailyHistory: []
          },
          routeReprobeExecution: {
            totals: {
              totalJobs: 2,
              queuedJobs: 0,
              runningJobs: 0,
              completedJobs: 0,
              deadLetterJobs: 2,
              retryScheduledCount: 0,
              leaseReclaimedCount: 0,
              overdueQueuedJobs: 0,
              staleRunningJobs: 0,
              completionRate: 0,
              deadLetterRate: 1,
              retryRate: 0
            },
            timing: {
              averageTimeToStartMinutes: null,
              medianTimeToStartMinutes: null,
              p95TimeToStartMinutes: null,
              averageLifecycleMinutes: null,
              medianLifecycleMinutes: null,
              p95LifecycleMinutes: null,
              oldestQueuedAgeMinutes: null,
              longestRunningAgeMinutes: null
            },
            workerHealth: {
              activeWorkerCount: 0,
              latestWorkerActivityAt: null,
              lastClaimedAt: null,
              lastCompletedAt: null
            },
            recentJobs: [],
            failureDrilldown: [],
            workerHotspots: [],
            networkHotspots: [],
            workerAlerts: [],
            timeline: [],
            focusedDrilldowns: {
              worker: null,
              network: null,
              job: null
            }
          }
        }),
      deliveryTransport: createDeliveryTransportStub()
    });

    const listed = await store.list({ refresh: true });

    expect(listed).toHaveLength(1);
    expect(listed[0]?.dedupeKey).toBe("dead-letter-jobs");
    expect(listed[0]?.status).toBe("active");
    expect(listed[0]?.severity).toBe("critical");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.metadata).toMatchObject({
      source: "route_decision_ops_summary",
      summarySeverity: "critical",
      generatedAt: "2026-07-07T19:00:00.000Z"
    });
  });

  it("persists inventory policy diagnosis in alert metadata and detail", async () => {
    const { prisma, alerts } = createPrismaStub();
    const store = createOpsAlertStore(prisma as never, {
      getRouteDecisionOpsSummary: async () =>
        createOpsSummary({
          generatedAt: "2026-07-07T19:10:00.000Z",
          operationalSummary: {
            overallSeverity: "watch",
            activeAlertCount: 1,
            alerts: [],
            inventoryHealth: {
              riskLevel: "watch",
              activeEndpoints: 2,
              distinctProviders: 2,
              distinctAsns: 2,
              distinctPools: 2,
              distinctRegions: 2,
              largestRegionalDomainSize: 1,
              minimumRecommendedFailureDomains: 3,
              failedDimensions: ["active endpoints 2/3", "providers 2/3", "ASNs 2/3", "regions 2/3"],
              policyViolationMessage:
                "Active inventory must keep at least 3 independent failure domains across provider/ASN/region; got active endpoints 2/3, providers 2/3, ASNs 2/3, regions 2/3."
            },
            retention: {
              probeReportsDays: 45,
              routeEventsDays: 45,
              routeReprobeJobsDays: 14,
              routeSuccessRollupsDays: 180,
              routeRankingsDays: 180
            },
            history: [],
            dailyHistory: []
          }
        }),
      deliveryTransport: createDeliveryTransportStub()
    });

    const listed = await store.list({ refresh: true });
    const inventoryAlert = listed.find((alert) => alert.dedupeKey === "inventory-failure-domain-risk");

    expect(inventoryAlert).toMatchObject({
      severity: "watch",
      detail:
        "Active inventory must keep at least 3 independent failure domains across provider/ASN/region; got active endpoints 2/3, providers 2/3, ASNs 2/3, regions 2/3."
    });
    expect(alerts.find((alert) => alert.dedupeKey === "inventory-failure-domain-risk")?.metadata).toMatchObject({
      source: "route_decision_ops_summary",
      summarySeverity: "watch",
      generatedAt: "2026-07-07T19:10:00.000Z",
      inventoryRiskLevel: "watch",
      inventoryFailedDimensions: ["active endpoints 2/3", "providers 2/3", "ASNs 2/3", "regions 2/3"],
      inventoryPolicyViolationMessage:
        "Active inventory must keep at least 3 independent failure domains across provider/ASN/region; got active endpoints 2/3, providers 2/3, ASNs 2/3, regions 2/3.",
      activeInventoryEndpoints: 2,
      distinctInventoryProviders: 2,
      distinctInventoryAsns: 2,
      distinctInventoryRegions: 2,
      minimumRecommendedFailureDomains: 3
    });
  });

  it("keeps acknowledged alerts sticky during refresh and resolves them when the signal disappears", async () => {
    const existingAlert: StoredAlert = {
      id: "persisted-1",
      alertType: "dead-letter-jobs",
      severity: "critical",
      status: OpsAlertStatus.acknowledged,
      dedupeKey: "dead-letter-jobs",
      title: "Old title",
      detail: "Old detail",
      metadata: {},
      startedAt: new Date("2026-07-07T18:00:00.000Z"),
      lastDetectedAt: new Date("2026-07-07T18:05:00.000Z"),
      acknowledgedAt: new Date("2026-07-07T18:10:00.000Z"),
      resolvedAt: null,
      snoozedUntil: null,
      createdAt: new Date("2026-07-07T18:00:00.000Z"),
      updatedAt: new Date("2026-07-07T18:10:00.000Z")
    };
    const { prisma } = createPrismaStub([existingAlert]);

    let summary = createOpsSummary({
      generatedAt: "2026-07-07T19:00:00.000Z",
      routeReprobeExecution: {
        totals: {
          totalJobs: 1,
          queuedJobs: 0,
          runningJobs: 0,
          completedJobs: 0,
          deadLetterJobs: 1,
          retryScheduledCount: 0,
          leaseReclaimedCount: 0,
          overdueQueuedJobs: 0,
          staleRunningJobs: 0,
          completionRate: 0,
          deadLetterRate: 1,
          retryRate: 0
        },
        timing: {
          averageTimeToStartMinutes: null,
          medianTimeToStartMinutes: null,
          p95TimeToStartMinutes: null,
          averageLifecycleMinutes: null,
          medianLifecycleMinutes: null,
          p95LifecycleMinutes: null,
          oldestQueuedAgeMinutes: null,
          longestRunningAgeMinutes: null
        },
        workerHealth: {
          activeWorkerCount: 0,
          latestWorkerActivityAt: null,
          lastClaimedAt: null,
          lastCompletedAt: null
        },
        recentJobs: [],
        failureDrilldown: [],
        workerHotspots: [],
        networkHotspots: [],
        workerAlerts: [],
        timeline: [],
        focusedDrilldowns: {
          worker: null,
          network: null,
          job: null
        }
      }
    });
    const store = createOpsAlertStore(prisma as never, {
      getRouteDecisionOpsSummary: async () => summary,
      deliveryTransport: createDeliveryTransportStub()
    });

    const refreshed = await store.list({ refresh: true, includeResolved: true });
    expect(refreshed[0]?.status).toBe("acknowledged");
    expect(refreshed[0]?.resolvedAt).toBeNull();
    expect(refreshed[0]?.title).toBe("Dead-letter jobs present");

    summary = createOpsSummary();
    const resolved = await store.list({ refresh: true, includeResolved: true });

    expect(resolved).toHaveLength(1);
    expect(resolved[0]?.status).toBe("resolved");
    expect(resolved[0]?.resolvedAt).not.toBeNull();
  });

  it("delivers critical alerts to the primary escalation tier first", async () => {
    const existingAlert: StoredAlert = {
      id: "persisted-2",
      alertType: "dead-letter-jobs",
      severity: "critical",
      status: OpsAlertStatus.active,
      dedupeKey: "dead-letter-jobs",
      title: "Dead-letter jobs present",
      detail: "2 reprobe jobs reached dead-letter.",
      metadata: {},
      startedAt: new Date("2026-07-07T18:00:00.000Z"),
      lastDetectedAt: new Date("2026-07-07T18:05:00.000Z"),
      acknowledgedAt: null,
      resolvedAt: null,
      snoozedUntil: null,
      createdAt: new Date("2026-07-07T18:00:00.000Z"),
      updatedAt: new Date("2026-07-07T18:10:00.000Z")
    };
    const { prisma, deliveries } = createPrismaStub([existingAlert]);
    const store = createOpsAlertStore(prisma as never, {
      getRouteDecisionOpsSummary: async () => createOpsSummary(),
      deliveryTransport: createDeliveryTransportStub()
    });

    const result = await store.deliver(existingAlert.id, "admin-actor");

    expect(result.preview.shouldEscalate).toBe(true);
    expect(result.deliveries).toHaveLength(1);
    expect(result.deliveries.every((delivery) => delivery.deliveryPath === "local_dev_outbox")).toBe(true);
    expect(result.deliveries.every((delivery) => delivery.status === "delivered")).toBe(true);
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]?.metadata).toMatchObject({
      chainStep: 1,
      escalationTier: "primary"
    });

    const listed = await store.listDeliveries(existingAlert.id, 10);
    expect(listed).toHaveLength(1);
    expect(listed.map((delivery) => delivery.channel)).toEqual(["telegram"]);
  });

  it("holds recent primary immediate recipient by cooldown and escalates to secondary tier", async () => {
    const existingAlert: StoredAlert = {
      id: "cooldown-immediate-alert",
      alertType: "dead-letter-jobs",
      severity: "critical",
      status: OpsAlertStatus.active,
      dedupeKey: "dead-letter-jobs",
      title: "Dead-letter jobs present",
      detail: "2 reprobe jobs reached dead-letter.",
      metadata: {},
      startedAt: new Date("2026-07-07T18:00:00.000Z"),
      lastDetectedAt: new Date("2026-07-07T18:05:00.000Z"),
      acknowledgedAt: null,
      resolvedAt: null,
      snoozedUntil: null,
      createdAt: new Date("2026-07-07T18:00:00.000Z"),
      updatedAt: new Date("2026-07-07T18:10:00.000Z")
    };
    const recentPrimaryDelivery: StoredDelivery = {
      id: "recent-primary-immediate",
      opsAlertId: existingAlert.id,
      batchId: "recent-batch-1",
      channel: ContactType.telegram,
      escalationLevel: "immediate",
      status: "delivered",
      recipientUserId: "admin-1",
      recipientDisplayName: "Alice Ops",
      recipientContact: "@alice_ops",
      subject: "[critical] Dead-letter jobs present",
      message: "Dead-letter jobs present",
      reason: "Primary admin contact for immediate triage of critical alert.",
      deliveryPath: "local_dev_outbox",
      providerMessageId: "recent-1",
      actorUserId: "admin-actor",
      deliveredAt: new Date(),
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date()
    };
    const { prisma } = createPrismaStub([existingAlert], [recentPrimaryDelivery]);
    const store = createOpsAlertStore(prisma as never, {
      getRouteDecisionOpsSummary: async () => createOpsSummary(),
      deliveryTransport: createDeliveryTransportStub(),
      immediateDeliveryCooldownMs: 60 * 60_000
    });

    const preview = await store.getEscalationPreview(existingAlert.id);
    expect(preview.recipients.map((recipient) => recipient.channel)).toEqual(["email"]);
    expect(preview.reason).toContain("Cooldown held 1 recipient");

    const result = await store.deliver(existingAlert.id, "admin-actor");
    expect(result.deliveries).toHaveLength(1);
    expect(result.deliveries[0]?.channel).toBe("email");
  });

  it("uses configured external transport paths and preserves explainable metadata", async () => {
    const existingAlert: StoredAlert = {
      id: "persisted-3",
      alertType: "dead-letter-jobs",
      severity: "critical",
      status: OpsAlertStatus.active,
      dedupeKey: "dead-letter-jobs",
      title: "Dead-letter jobs present",
      detail: "2 reprobe jobs reached dead-letter.",
      metadata: {},
      startedAt: new Date("2026-07-07T18:00:00.000Z"),
      lastDetectedAt: new Date("2026-07-07T18:05:00.000Z"),
      acknowledgedAt: null,
      resolvedAt: null,
      snoozedUntil: null,
      createdAt: new Date("2026-07-07T18:00:00.000Z"),
      updatedAt: new Date("2026-07-07T18:10:00.000Z")
    };
    const { prisma } = createPrismaStub([existingAlert]);
    const store = createOpsAlertStore(prisma as never, {
      getRouteDecisionOpsSummary: async () => createOpsSummary(),
      deliveryTransport: createDeliveryTransportStub({
        telegram: {
          status: "delivered",
          deliveryPath: "telegram_bot_api",
          providerMessageId: "tg-42",
          deliveredAt: new Date("2026-07-08T00:01:00.000Z"),
          metadata: {
            provider: "telegram_bot_api",
            chatId: "123456"
          }
        },
        email: {
          status: "delivered",
          deliveryPath: "resend_api",
          providerMessageId: "re_42",
          deliveredAt: new Date("2026-07-08T00:02:00.000Z"),
          metadata: {
            provider: "resend"
          }
        }
      })
    });

    const result = await store.deliver(existingAlert.id, "admin-actor");

    expect(result.deliveries.map((delivery) => delivery.deliveryPath)).toEqual(["telegram_bot_api"]);
    expect(result.deliveries[0]?.providerMessageId).toBe("tg-42");
    expect(result.deliveries[0]?.metadata.transport).toEqual({
      provider: "telegram_bot_api",
      chatId: "123456"
    });
  });

  it("escalates to the secondary tier when the primary immediate path fails", async () => {
    const existingAlert: StoredAlert = {
      id: "persisted-3b",
      alertType: "dead-letter-jobs",
      severity: "critical",
      status: OpsAlertStatus.active,
      dedupeKey: "dead-letter-jobs",
      title: "Dead-letter jobs present",
      detail: "2 reprobe jobs reached dead-letter.",
      metadata: {},
      startedAt: new Date("2026-07-07T18:00:00.000Z"),
      lastDetectedAt: new Date("2026-07-07T18:05:00.000Z"),
      acknowledgedAt: null,
      resolvedAt: null,
      snoozedUntil: null,
      createdAt: new Date("2026-07-07T18:00:00.000Z"),
      updatedAt: new Date("2026-07-07T18:10:00.000Z")
    };
    const { prisma } = createPrismaStub([existingAlert]);
    const store = createOpsAlertStore(prisma as never, {
      getRouteDecisionOpsSummary: async () => createOpsSummary(),
      deliveryTransport: createDeliveryTransportStub({
        telegram: {
          status: "failed",
          deliveryPath: "telegram_bot_api",
          providerMessageId: null,
          deliveredAt: null,
          failureReason: "Primary channel failed."
        },
        email: {
          status: "delivered",
          deliveryPath: "resend_api",
          providerMessageId: "re_42",
          deliveredAt: new Date("2026-07-08T00:02:00.000Z"),
          metadata: {
            provider: "resend"
          }
        }
      })
    });

    const result = await store.deliver(existingAlert.id, "admin-actor");

    expect(result.deliveries.map((delivery) => delivery.channel)).toEqual(["telegram", "email"]);
    expect(result.deliveries.map((delivery) => delivery.metadata.chainStep)).toEqual([1, 2]);
    expect(result.deliveries[1]?.deliveryPath).toBe("resend_api");
  });

  it("persists failed transport attempts without losing the local delivery trail", async () => {
    const existingAlert: StoredAlert = {
      id: "persisted-4",
      alertType: "dead-letter-jobs",
      severity: "critical",
      status: OpsAlertStatus.active,
      dedupeKey: "dead-letter-jobs",
      title: "Dead-letter jobs present",
      detail: "2 reprobe jobs reached dead-letter.",
      metadata: {},
      startedAt: new Date("2026-07-07T18:00:00.000Z"),
      lastDetectedAt: new Date("2026-07-07T18:05:00.000Z"),
      acknowledgedAt: null,
      resolvedAt: null,
      snoozedUntil: null,
      createdAt: new Date("2026-07-07T18:00:00.000Z"),
      updatedAt: new Date("2026-07-07T18:10:00.000Z")
    };
    const { prisma } = createPrismaStub([existingAlert]);
    const store = createOpsAlertStore(prisma as never, {
      getRouteDecisionOpsSummary: async () => createOpsSummary(),
      deliveryTransport: createDeliveryTransportStub({
        telegram: {
          status: "failed",
          deliveryPath: "telegram_bot_api",
          providerMessageId: null,
          deliveredAt: null,
          failureReason: "Telegram contact must be a numeric chat id or chat:<id> for Bot API delivery."
        }
      })
    });

    const result = await store.deliver(existingAlert.id, "admin-actor");
    const failedEntry = result.deliveries.find((delivery) => delivery.channel === "telegram");

    expect(failedEntry?.status).toBe("failed");
    expect(failedEntry?.deliveryPath).toBe("telegram_bot_api");
    expect(failedEntry?.reason).toContain("numeric chat id");
    expect(failedEntry?.metadata.failureReason).toContain("numeric chat id");
    expect(result.deliveries.find((delivery) => delivery.channel === "email")?.status).toBe("delivered");
  });

  it("rejects direct delivery for digest-level alerts", async () => {
    const existingAlert: StoredAlert = {
      id: "persisted-watch-1",
      alertType: "inventory-failure-domain-risk",
      severity: "watch",
      status: OpsAlertStatus.active,
      dedupeKey: "inventory-failure-domain-risk",
      title: "Server inventory is not diverse enough",
      detail: "Inventory risk remains at watch level.",
      metadata: {},
      startedAt: new Date("2026-07-07T18:00:00.000Z"),
      lastDetectedAt: new Date("2026-07-07T18:05:00.000Z"),
      acknowledgedAt: null,
      resolvedAt: null,
      snoozedUntil: null,
      createdAt: new Date("2026-07-07T18:00:00.000Z"),
      updatedAt: new Date("2026-07-07T18:10:00.000Z")
    };
    const { prisma } = createPrismaStub([existingAlert]);
    const store = createOpsAlertStore(prisma as never, {
      getRouteDecisionOpsSummary: async () => createOpsSummary(),
      deliveryTransport: createDeliveryTransportStub()
    });

    await expect(store.deliver(existingAlert.id, "admin-actor")).rejects.toThrow(
      "Digest-level ops alerts must be delivered through the digest batch flow"
    );
  });

  it("delivers active watch alerts through a single digest batch per recipient", async () => {
    const activeWatchA: StoredAlert = {
      id: "watch-1",
      alertType: "inventory-failure-domain-risk",
      severity: "watch",
      status: OpsAlertStatus.active,
      dedupeKey: "inventory-failure-domain-risk",
      title: "Server inventory is not diverse enough",
      detail: "Inventory risk remains at watch level.",
      metadata: {
        source: "route_decision_ops_summary",
        inventoryFailedDimensions: ["providers 2/3"],
        inventoryPolicyViolationMessage: "Inventory needs more independent providers."
      },
      startedAt: new Date("2026-07-07T18:00:00.000Z"),
      lastDetectedAt: new Date("2026-07-07T18:05:00.000Z"),
      acknowledgedAt: null,
      resolvedAt: null,
      snoozedUntil: null,
      createdAt: new Date("2026-07-07T18:00:00.000Z"),
      updatedAt: new Date("2026-07-07T18:10:00.000Z")
    };
    const activeWatchB: StoredAlert = {
      id: "watch-2",
      alertType: "route-quality-watch",
      severity: "watch",
      status: OpsAlertStatus.active,
      dedupeKey: "route-quality-watch",
      title: "Route quality is drifting",
      detail: "Fallback pressure is elevated across recent windows.",
      metadata: {},
      startedAt: new Date("2026-07-07T18:10:00.000Z"),
      lastDetectedAt: new Date("2026-07-07T18:20:00.000Z"),
      acknowledgedAt: null,
      resolvedAt: null,
      snoozedUntil: null,
      createdAt: new Date("2026-07-07T18:10:00.000Z"),
      updatedAt: new Date("2026-07-07T18:20:00.000Z")
    };
    const { prisma, deliveries } = createPrismaStub([activeWatchA, activeWatchB]);
    const transport = createDeliveryTransportStub();
    const store = createOpsAlertStore(prisma as never, {
      getRouteDecisionOpsSummary: async () => createOpsSummary(),
      deliveryTransport: transport
    });

    const result = await store.deliverDigest("admin-actor");

    expect(result.alerts.map((alert) => alert.id)).toEqual(["watch-2", "watch-1"]);
    expect(result.deliveries).toHaveLength(2);
    expect(new Set(result.deliveries.map((delivery) => delivery.batchId)).size).toBe(1);
    expect(transport.calls).toHaveLength(1);
    expect(transport.calls[0]?.subject).toContain("[digest/watch]");
    expect(transport.calls[0]?.message).toContain("Included alerts: 2");
    expect(deliveries.every((delivery) => delivery.escalationLevel === "digest")).toBe(true);
    expect(deliveries[0]?.metadata).toMatchObject({
      digestAlertCount: 2,
      chainStep: 1,
      escalationTier: "primary"
    });
  });

  it("holds digest delivery when all recipients are still inside cooldown", async () => {
    const activeWatchA: StoredAlert = {
      id: "digest-cooldown-1",
      alertType: "inventory-failure-domain-risk",
      severity: "watch",
      status: OpsAlertStatus.active,
      dedupeKey: "inventory-failure-domain-risk",
      title: "Server inventory is not diverse enough",
      detail: "Inventory risk remains at watch level.",
      metadata: {},
      startedAt: new Date("2026-07-07T18:00:00.000Z"),
      lastDetectedAt: new Date("2026-07-07T18:05:00.000Z"),
      acknowledgedAt: null,
      resolvedAt: null,
      snoozedUntil: null,
      createdAt: new Date("2026-07-07T18:00:00.000Z"),
      updatedAt: new Date("2026-07-07T18:10:00.000Z")
    };
    const activeWatchB: StoredAlert = {
      id: "digest-cooldown-2",
      alertType: "route-quality-watch",
      severity: "watch",
      status: OpsAlertStatus.active,
      dedupeKey: "route-quality-watch",
      title: "Route quality is drifting",
      detail: "Fallback pressure is elevated across recent windows.",
      metadata: {},
      startedAt: new Date("2026-07-07T18:10:00.000Z"),
      lastDetectedAt: new Date("2026-07-07T18:20:00.000Z"),
      acknowledgedAt: null,
      resolvedAt: null,
      snoozedUntil: null,
      createdAt: new Date("2026-07-07T18:10:00.000Z"),
      updatedAt: new Date("2026-07-07T18:20:00.000Z")
    };
    const recentPrimaryDigest: StoredDelivery = {
      id: "recent-digest-primary",
      opsAlertId: activeWatchA.id,
      batchId: "digest-recent-1",
      channel: ContactType.telegram,
      escalationLevel: "digest",
      status: "delivered",
      recipientUserId: "admin-1",
      recipientDisplayName: "Alice Ops",
      recipientContact: "@alice_ops",
      subject: "[digest/watch] 2 ops alerts need follow-up",
      message: "Watch-level ops digest",
      reason: "Primary digest recipient for watch-level follow-up.",
      deliveryPath: "local_dev_outbox",
      providerMessageId: "digest-recent-primary",
      actorUserId: "admin-actor",
      deliveredAt: new Date(),
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date()
    };
    const recentSecondaryDigest: StoredDelivery = {
      ...recentPrimaryDigest,
      id: "recent-digest-secondary",
      channel: ContactType.email,
      recipientUserId: "admin-2",
      recipientDisplayName: "Bob SRE",
      recipientContact: "bob@example.com",
      providerMessageId: "digest-recent-secondary"
    };
    const { prisma } = createPrismaStub([activeWatchA, activeWatchB], [recentPrimaryDigest, recentSecondaryDigest]);
    const store = createOpsAlertStore(prisma as never, {
      getRouteDecisionOpsSummary: async () => createOpsSummary(),
      deliveryTransport: createDeliveryTransportStub(),
      digestDeliveryCooldownMs: 24 * 60 * 60_000
    });

    await expect(store.deliverDigest("admin-actor")).rejects.toThrow(
      "Ops alert digest delivery is currently held by cooldown policy"
    );
  });

  it("uses secondary digest recipient when cadence holds the primary recipient", async () => {
    const activeWatchA: StoredAlert = {
      id: "digest-cadence-1",
      alertType: "inventory-failure-domain-risk",
      severity: "watch",
      status: OpsAlertStatus.active,
      dedupeKey: "inventory-failure-domain-risk",
      title: "Server inventory is not diverse enough",
      detail: "Inventory risk remains at watch level.",
      metadata: {},
      startedAt: new Date("2026-07-07T18:00:00.000Z"),
      lastDetectedAt: new Date("2026-07-07T18:05:00.000Z"),
      acknowledgedAt: null,
      resolvedAt: null,
      snoozedUntil: null,
      createdAt: new Date("2026-07-07T18:00:00.000Z"),
      updatedAt: new Date("2026-07-07T18:10:00.000Z")
    };
    const activeWatchB: StoredAlert = {
      id: "digest-cadence-2",
      alertType: "route-quality-watch",
      severity: "watch",
      status: OpsAlertStatus.active,
      dedupeKey: "route-quality-watch",
      title: "Route quality is drifting",
      detail: "Fallback pressure is elevated across recent windows.",
      metadata: {},
      startedAt: new Date("2026-07-07T18:10:00.000Z"),
      lastDetectedAt: new Date("2026-07-07T18:20:00.000Z"),
      acknowledgedAt: null,
      resolvedAt: null,
      snoozedUntil: null,
      createdAt: new Date("2026-07-07T18:10:00.000Z"),
      updatedAt: new Date("2026-07-07T18:20:00.000Z")
    };
    const recentPrimaryDigest: StoredDelivery = {
      id: "recent-cadence-primary",
      opsAlertId: activeWatchA.id,
      batchId: "digest-cadence-recent-1",
      channel: ContactType.telegram,
      escalationLevel: "digest",
      status: "delivered",
      recipientUserId: "admin-1",
      recipientDisplayName: "Alice Ops",
      recipientContact: "@alice_ops",
      subject: "[digest/watch] 1 ops alerts need follow-up",
      message: "Recent watch-level ops digest",
      reason: "Primary digest recipient for watch-level follow-up.",
      deliveryPath: "local_dev_outbox",
      providerMessageId: "digest-cadence-primary",
      actorUserId: "admin-actor",
      deliveredAt: new Date(),
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date()
    };
    const { prisma } = createPrismaStub([activeWatchA, activeWatchB], [recentPrimaryDigest]);
    const store = createOpsAlertStore(prisma as never, {
      getRouteDecisionOpsSummary: async () => createOpsSummary(),
      deliveryTransport: createDeliveryTransportStub(),
      digestDeliveryCooldownMs: 0,
      digestCadenceMs: 24 * 60 * 60_000
    });

    const result = await store.deliverDigest("admin-actor");

    expect(result.deliveries).toHaveLength(2);
    expect(result.deliveries.every((delivery) => delivery.channel === "email")).toBe(true);
  });

  it("holds digest delivery when all recipients are still inside cadence window", async () => {
    const activeWatchA: StoredAlert = {
      id: "digest-cadence-hold-1",
      alertType: "inventory-failure-domain-risk",
      severity: "watch",
      status: OpsAlertStatus.active,
      dedupeKey: "inventory-failure-domain-risk",
      title: "Server inventory is not diverse enough",
      detail: "Inventory risk remains at watch level.",
      metadata: {},
      startedAt: new Date("2026-07-07T18:00:00.000Z"),
      lastDetectedAt: new Date("2026-07-07T18:05:00.000Z"),
      acknowledgedAt: null,
      resolvedAt: null,
      snoozedUntil: null,
      createdAt: new Date("2026-07-07T18:00:00.000Z"),
      updatedAt: new Date("2026-07-07T18:10:00.000Z")
    };
    const activeWatchB: StoredAlert = {
      id: "digest-cadence-hold-2",
      alertType: "route-quality-watch",
      severity: "watch",
      status: OpsAlertStatus.active,
      dedupeKey: "route-quality-watch",
      title: "Route quality is drifting",
      detail: "Fallback pressure is elevated across recent windows.",
      metadata: {},
      startedAt: new Date("2026-07-07T18:10:00.000Z"),
      lastDetectedAt: new Date("2026-07-07T18:20:00.000Z"),
      acknowledgedAt: null,
      resolvedAt: null,
      snoozedUntil: null,
      createdAt: new Date("2026-07-07T18:10:00.000Z"),
      updatedAt: new Date("2026-07-07T18:20:00.000Z")
    };
    const recentPrimaryDigest: StoredDelivery = {
      id: "recent-cadence-hold-primary",
      opsAlertId: activeWatchA.id,
      batchId: "digest-cadence-hold-1",
      channel: ContactType.telegram,
      escalationLevel: "digest",
      status: "delivered",
      recipientUserId: "admin-1",
      recipientDisplayName: "Alice Ops",
      recipientContact: "@alice_ops",
      subject: "[digest/watch] 1 ops alerts need follow-up",
      message: "Recent watch-level ops digest",
      reason: "Primary digest recipient for watch-level follow-up.",
      deliveryPath: "local_dev_outbox",
      providerMessageId: "digest-cadence-hold-primary",
      actorUserId: "admin-actor",
      deliveredAt: new Date(),
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date()
    };
    const recentSecondaryDigest: StoredDelivery = {
      ...recentPrimaryDigest,
      id: "recent-cadence-hold-secondary",
      channel: ContactType.email,
      recipientUserId: "admin-2",
      recipientDisplayName: "Bob SRE",
      recipientContact: "bob@example.com",
      providerMessageId: "digest-cadence-hold-secondary"
    };
    const { prisma } = createPrismaStub([activeWatchA, activeWatchB], [recentPrimaryDigest, recentSecondaryDigest]);
    const store = createOpsAlertStore(prisma as never, {
      getRouteDecisionOpsSummary: async () => createOpsSummary(),
      deliveryTransport: createDeliveryTransportStub(),
      digestDeliveryCooldownMs: 0,
      digestCadenceMs: 24 * 60 * 60_000
    });

    await expect(store.deliverDigest("admin-actor")).rejects.toThrow(
      "Ops alert digest delivery is currently held by digest cadence policy"
    );
  });

  it("uses secondary digest tier outside the quiet window when after-hours fallback exists", async () => {
    const activeWatch: StoredAlert = {
      id: "digest-quiet-window-1",
      alertType: "inventory-failure-domain-risk",
      severity: "watch",
      status: OpsAlertStatus.active,
      dedupeKey: "inventory-failure-domain-risk",
      title: "Server inventory is not diverse enough",
      detail: "Inventory risk remains at watch level.",
      metadata: {},
      startedAt: new Date("2026-07-07T18:00:00.000Z"),
      lastDetectedAt: new Date("2026-07-07T18:05:00.000Z"),
      acknowledgedAt: null,
      resolvedAt: null,
      snoozedUntil: null,
      createdAt: new Date("2026-07-07T18:00:00.000Z"),
      updatedAt: new Date("2026-07-07T18:10:00.000Z")
    };
    const { prisma } = createPrismaStub([activeWatch]);
    const store = createOpsAlertStore(prisma as never, {
      getRouteDecisionOpsSummary: async () => createOpsSummary(),
      deliveryTransport: createDeliveryTransportStub(),
      digestDeliveryCooldownMs: 0,
      digestCadenceMs: 0,
      digestWindowStartHourUtc: 7,
      digestWindowEndHourUtc: 23,
      now: () => new Date("2026-07-08T02:30:00.000Z")
    });

    const preview = await store.getEscalationPreview(activeWatch.id);
    expect(preview.shouldEscalate).toBe(true);
    expect(preview.recipients.map((recipient) => recipient.channel)).toEqual(["email"]);
    expect(preview.reason).toContain("Quiet window is holding 1 primary recipient");

    const result = await store.deliverDigest("admin-actor");
    expect(result.deliveries).toHaveLength(1);
    expect(result.deliveries[0]?.channel).toBe("email");
  });

  it("holds digest delivery outside the quiet window when no secondary after-hours fallback exists", async () => {
    const activeWatch: StoredAlert = {
      id: "digest-quiet-window-hold",
      alertType: "inventory-failure-domain-risk",
      severity: "watch",
      status: OpsAlertStatus.active,
      dedupeKey: "inventory-failure-domain-risk",
      title: "Server inventory is not diverse enough",
      detail: "Inventory risk remains at watch level.",
      metadata: {},
      startedAt: new Date("2026-07-07T18:00:00.000Z"),
      lastDetectedAt: new Date("2026-07-07T18:05:00.000Z"),
      acknowledgedAt: null,
      resolvedAt: null,
      snoozedUntil: null,
      createdAt: new Date("2026-07-07T18:00:00.000Z"),
      updatedAt: new Date("2026-07-07T18:10:00.000Z")
    };
    const { prisma } = createPrismaStub(
      [activeWatch],
      [],
      [
        {
          id: "admin-1",
          displayName: "Alice Ops",
          contact: "@alice_ops",
          contactType: ContactType.telegram,
          opsAlertImmediateEnabled: true,
          opsAlertDigestEnabled: true,
          opsAlertEscalationTier: "primary",
          status: UserStatus.active,
          memberSince: new Date("2026-07-01T00:00:00.000Z")
        }
      ]
    );
    const store = createOpsAlertStore(prisma as never, {
      getRouteDecisionOpsSummary: async () => createOpsSummary(),
      deliveryTransport: createDeliveryTransportStub(),
      digestDeliveryCooldownMs: 0,
      digestCadenceMs: 0,
      digestWindowStartHourUtc: 7,
      digestWindowEndHourUtc: 23,
      now: () => new Date("2026-07-08T02:30:00.000Z")
    });

    const preview = await store.getEscalationPreview(activeWatch.id);
    expect(preview.shouldEscalate).toBe(false);
    expect(preview.reason).toContain("Digest delivery window is currently closed");

    await expect(store.deliverDigest("admin-actor")).rejects.toThrow(
      "Ops alert digest delivery is currently held by quiet window policy"
    );
  });

  it("delivers digest successfully when current time is inside the allowed window", async () => {
    const activeWatch: StoredAlert = {
      id: "digest-quiet-window-2",
      alertType: "route-quality-watch",
      severity: "watch",
      status: OpsAlertStatus.active,
      dedupeKey: "route-quality-watch",
      title: "Route quality is drifting",
      detail: "Fallback pressure is elevated across recent windows.",
      metadata: {},
      startedAt: new Date("2026-07-07T18:10:00.000Z"),
      lastDetectedAt: new Date("2026-07-07T18:20:00.000Z"),
      acknowledgedAt: null,
      resolvedAt: null,
      snoozedUntil: null,
      createdAt: new Date("2026-07-07T18:10:00.000Z"),
      updatedAt: new Date("2026-07-07T18:20:00.000Z")
    };
    const { prisma } = createPrismaStub([activeWatch]);
    const store = createOpsAlertStore(prisma as never, {
      getRouteDecisionOpsSummary: async () => createOpsSummary(),
      deliveryTransport: createDeliveryTransportStub(),
      digestDeliveryCooldownMs: 0,
      digestCadenceMs: 0,
      digestWindowStartHourUtc: 7,
      digestWindowEndHourUtc: 23,
      now: () => new Date("2026-07-08T12:30:00.000Z")
    });

    const preview = await store.getEscalationPreview(activeWatch.id);
    expect(preview.shouldEscalate).toBe(true);
    expect(preview.recipients.length).toBeGreaterThan(0);

    const result = await store.deliverDigest("admin-actor");
    expect(result.deliveries).toHaveLength(1);
    expect(result.deliveries[0]?.channel).toBe("telegram");
  });

  it("retries failed immediate deliveries and links them back to the original attempt", async () => {
    const existingAlert: StoredAlert = {
      id: "retry-immediate-alert",
      alertType: "dead-letter-jobs",
      severity: "critical",
      status: OpsAlertStatus.active,
      dedupeKey: "dead-letter-jobs",
      title: "Dead-letter jobs present",
      detail: "2 reprobe jobs reached dead-letter.",
      metadata: {},
      startedAt: new Date("2026-07-07T18:00:00.000Z"),
      lastDetectedAt: new Date("2026-07-07T18:05:00.000Z"),
      acknowledgedAt: null,
      resolvedAt: null,
      snoozedUntil: null,
      createdAt: new Date("2026-07-07T18:00:00.000Z"),
      updatedAt: new Date("2026-07-07T18:10:00.000Z")
    };
    const failedDelivery: StoredDelivery = {
      id: "failed-immediate-1",
      opsAlertId: existingAlert.id,
      batchId: "batch-immediate-1",
      channel: ContactType.telegram,
      escalationLevel: "immediate",
      status: "failed",
      recipientUserId: "admin-1",
      recipientDisplayName: "Alice Ops",
      recipientContact: "@alice_ops",
      subject: "[critical] Dead-letter jobs present",
      message: "Dead-letter jobs present",
      reason: "Primary channel failed.",
      deliveryPath: "telegram_bot_api",
      providerMessageId: null,
      actorUserId: "admin-actor",
      deliveredAt: null,
      metadata: {
        chainStep: 1,
        escalationTier: "primary",
        failureReason: "Primary channel failed."
      },
      createdAt: new Date("2026-07-08T10:00:00.000Z"),
      updatedAt: new Date("2026-07-08T10:00:00.000Z")
    };
    const { prisma, deliveries } = createPrismaStub([existingAlert], [failedDelivery]);
    const transport = createDeliveryTransportStub({
      telegram: {
        status: "delivered",
        deliveryPath: "telegram_bot_api",
        providerMessageId: "tg-retry-1",
        deliveredAt: new Date("2026-07-08T10:05:00.000Z"),
        metadata: {
          provider: "telegram_bot_api",
          chatId: "123456"
        }
      }
    });
    const store = createOpsAlertStore(prisma as never, {
      getRouteDecisionOpsSummary: async () => createOpsSummary(),
      deliveryTransport: transport
    });

    const listed = await store.retryDelivery(existingAlert.id, failedDelivery.id, "admin-retry");

    expect(transport.calls).toHaveLength(1);
    expect(deliveries).toHaveLength(2);
    const retriedDelivery = listed.find((delivery) => delivery.metadata.retryOfDeliveryId === "failed-immediate-1");
    expect(retriedDelivery?.providerMessageId).toBe("tg-retry-1");
    expect(retriedDelivery?.metadata).toMatchObject({
      retryOfDeliveryId: "failed-immediate-1",
      retryOfBatchId: "batch-immediate-1",
      retryCount: 1,
      retryGroupSize: 1,
      retryActorUserId: "admin-retry",
      transport: {
        provider: "telegram_bot_api",
        chatId: "123456"
      }
    });
  });

  it("retries failed digest deliveries by replaying the whole recipient batch once", async () => {
    const watchAlertA: StoredAlert = {
      id: "retry-watch-1",
      alertType: "inventory-failure-domain-risk",
      severity: "watch",
      status: OpsAlertStatus.active,
      dedupeKey: "inventory-failure-domain-risk",
      title: "Server inventory is not diverse enough",
      detail: "Inventory risk remains at watch level.",
      metadata: {},
      startedAt: new Date("2026-07-07T18:00:00.000Z"),
      lastDetectedAt: new Date("2026-07-07T18:05:00.000Z"),
      acknowledgedAt: null,
      resolvedAt: null,
      snoozedUntil: null,
      createdAt: new Date("2026-07-07T18:00:00.000Z"),
      updatedAt: new Date("2026-07-07T18:10:00.000Z")
    };
    const watchAlertB: StoredAlert = {
      id: "retry-watch-2",
      alertType: "route-quality-watch",
      severity: "watch",
      status: OpsAlertStatus.active,
      dedupeKey: "route-quality-watch",
      title: "Route quality is drifting",
      detail: "Fallback pressure is elevated across recent windows.",
      metadata: {},
      startedAt: new Date("2026-07-07T18:10:00.000Z"),
      lastDetectedAt: new Date("2026-07-07T18:20:00.000Z"),
      acknowledgedAt: null,
      resolvedAt: null,
      snoozedUntil: null,
      createdAt: new Date("2026-07-07T18:10:00.000Z"),
      updatedAt: new Date("2026-07-07T18:20:00.000Z")
    };
    const failedDigestA: StoredDelivery = {
      id: "failed-digest-a",
      opsAlertId: watchAlertA.id,
      batchId: "digest-batch-1",
      channel: ContactType.telegram,
      escalationLevel: "digest",
      status: "failed",
      recipientUserId: "admin-1",
      recipientDisplayName: "Alice Ops",
      recipientContact: "@alice_ops",
      subject: "[digest/watch] 2 ops alerts need follow-up",
      message: "Watch-level ops digest",
      reason: "Primary digest failed.",
      deliveryPath: "telegram_bot_api",
      providerMessageId: null,
      actorUserId: "admin-actor",
      deliveredAt: null,
      metadata: {
        digestAlertIds: [watchAlertB.id, watchAlertA.id],
        digestAlertCount: 2,
        chainStep: 1,
        escalationTier: "primary",
        failureReason: "Primary digest failed."
      },
      createdAt: new Date("2026-07-08T11:00:00.000Z"),
      updatedAt: new Date("2026-07-08T11:00:00.000Z")
    };
    const failedDigestB: StoredDelivery = {
      ...failedDigestA,
      id: "failed-digest-b",
      opsAlertId: watchAlertB.id
    };
    const { prisma, deliveries } = createPrismaStub([watchAlertA, watchAlertB], [failedDigestA, failedDigestB]);
    const transport = createDeliveryTransportStub({
      telegram: {
        status: "delivered",
        deliveryPath: "telegram_bot_api",
        providerMessageId: "tg-digest-retry-1",
        deliveredAt: new Date("2026-07-08T11:05:00.000Z"),
        metadata: {
          provider: "telegram_bot_api",
          chatId: "123456"
        }
      }
    });
    const store = createOpsAlertStore(prisma as never, {
      getRouteDecisionOpsSummary: async () => createOpsSummary(),
      deliveryTransport: transport
    });

    const listed = await store.retryDelivery(watchAlertA.id, failedDigestA.id, "admin-retry");

    expect(transport.calls).toHaveLength(1);
    expect(deliveries).toHaveLength(4);
    expect(deliveries.slice(-2).every((delivery) => delivery.batchId !== "digest-batch-1")).toBe(true);
    const retriedDigestDelivery = listed.find((delivery) => delivery.metadata.retryOfDeliveryId === "failed-digest-a");
    expect(retriedDigestDelivery?.metadata).toMatchObject({
      retryOfDeliveryId: "failed-digest-a",
      retryOfBatchId: "digest-batch-1",
      retryCount: 1,
      retryGroupSize: 2
    });
    expect(deliveries.find((delivery) => delivery.id !== "failed-digest-a" && delivery.id !== "failed-digest-b" && delivery.opsAlertId === watchAlertB.id)?.providerMessageId).toBe(
      "tg-digest-retry-1"
    );
  });

  it("resends delivered immediate entries as a separate operator-driven replay", async () => {
    const existingAlert: StoredAlert = {
      id: "resend-immediate-alert",
      alertType: "dead-letter-jobs",
      severity: "critical",
      status: OpsAlertStatus.active,
      dedupeKey: "dead-letter-jobs",
      title: "Dead-letter jobs present",
      detail: "2 reprobe jobs reached dead-letter.",
      metadata: {},
      startedAt: new Date("2026-07-07T18:00:00.000Z"),
      lastDetectedAt: new Date("2026-07-07T18:05:00.000Z"),
      acknowledgedAt: null,
      resolvedAt: null,
      snoozedUntil: null,
      createdAt: new Date("2026-07-07T18:00:00.000Z"),
      updatedAt: new Date("2026-07-07T18:10:00.000Z")
    };
    const deliveredEntry: StoredDelivery = {
      id: "delivered-immediate-1",
      opsAlertId: existingAlert.id,
      batchId: "batch-delivered-1",
      channel: ContactType.telegram,
      escalationLevel: "immediate",
      status: "delivered",
      recipientUserId: "admin-1",
      recipientDisplayName: "Alice Ops",
      recipientContact: "@alice_ops",
      subject: "[critical] Dead-letter jobs present",
      message: "Dead-letter jobs present",
      reason: "Primary admin contact for immediate triage of critical alert.",
      deliveryPath: "telegram_bot_api",
      providerMessageId: "tg-original-1",
      actorUserId: "admin-actor",
      deliveredAt: new Date("2026-07-08T12:00:00.000Z"),
      metadata: {
        chainStep: 1,
        escalationTier: "primary",
        transport: {
          provider: "telegram_bot_api",
          chatId: "123456"
        }
      },
      createdAt: new Date("2026-07-08T12:00:00.000Z"),
      updatedAt: new Date("2026-07-08T12:00:00.000Z")
    };
    const { prisma, deliveries } = createPrismaStub([existingAlert], [deliveredEntry]);
    const transport = createDeliveryTransportStub({
      telegram: {
        status: "delivered",
        deliveryPath: "telegram_bot_api",
        providerMessageId: "tg-resend-1",
        deliveredAt: new Date("2026-07-08T12:05:00.000Z"),
        metadata: {
          provider: "telegram_bot_api",
          chatId: "123456"
        }
      }
    });
    const store = createOpsAlertStore(prisma as never, {
      getRouteDecisionOpsSummary: async () => createOpsSummary(),
      deliveryTransport: transport
    });

    const listed = await store.resendDelivery(existingAlert.id, deliveredEntry.id, "admin-resend");

    expect(transport.calls).toHaveLength(1);
    expect(deliveries).toHaveLength(2);
    const resentDelivery = listed.find((delivery) => delivery.metadata.resendOfDeliveryId === "delivered-immediate-1");
    expect(resentDelivery?.providerMessageId).toBe("tg-resend-1");
    expect(resentDelivery?.metadata).toMatchObject({
      replayType: "resend",
      replayOfDeliveryId: "delivered-immediate-1",
      resendOfDeliveryId: "delivered-immediate-1",
      resendOfBatchId: "batch-delivered-1",
      resendCount: 1,
      resendGroupSize: 1,
      resendActorUserId: "admin-resend"
    });
  });

  it("resends delivered digest entries by replaying the full recipient batch", async () => {
    const watchAlertA: StoredAlert = {
      id: "resend-watch-1",
      alertType: "inventory-failure-domain-risk",
      severity: "watch",
      status: OpsAlertStatus.active,
      dedupeKey: "inventory-failure-domain-risk",
      title: "Server inventory is not diverse enough",
      detail: "Inventory risk remains at watch level.",
      metadata: {},
      startedAt: new Date("2026-07-07T18:00:00.000Z"),
      lastDetectedAt: new Date("2026-07-07T18:05:00.000Z"),
      acknowledgedAt: null,
      resolvedAt: null,
      snoozedUntil: null,
      createdAt: new Date("2026-07-07T18:00:00.000Z"),
      updatedAt: new Date("2026-07-07T18:10:00.000Z")
    };
    const watchAlertB: StoredAlert = {
      id: "resend-watch-2",
      alertType: "route-quality-watch",
      severity: "watch",
      status: OpsAlertStatus.active,
      dedupeKey: "route-quality-watch",
      title: "Route quality is drifting",
      detail: "Fallback pressure is elevated across recent windows.",
      metadata: {},
      startedAt: new Date("2026-07-07T18:10:00.000Z"),
      lastDetectedAt: new Date("2026-07-07T18:20:00.000Z"),
      acknowledgedAt: null,
      resolvedAt: null,
      snoozedUntil: null,
      createdAt: new Date("2026-07-07T18:10:00.000Z"),
      updatedAt: new Date("2026-07-07T18:20:00.000Z")
    };
    const deliveredDigestA: StoredDelivery = {
      id: "delivered-digest-a",
      opsAlertId: watchAlertA.id,
      batchId: "digest-delivered-1",
      channel: ContactType.telegram,
      escalationLevel: "digest",
      status: "delivered",
      recipientUserId: "admin-1",
      recipientDisplayName: "Alice Ops",
      recipientContact: "@alice_ops",
      subject: "[digest/watch] 2 ops alerts need follow-up",
      message: "Watch-level ops digest",
      reason: "Primary digest recipient for watch-level follow-up.",
      deliveryPath: "telegram_bot_api",
      providerMessageId: "tg-digest-original-1",
      actorUserId: "admin-actor",
      deliveredAt: new Date("2026-07-08T13:00:00.000Z"),
      metadata: {
        digestAlertIds: [watchAlertB.id, watchAlertA.id],
        digestAlertCount: 2,
        chainStep: 1,
        escalationTier: "primary"
      },
      createdAt: new Date("2026-07-08T13:00:00.000Z"),
      updatedAt: new Date("2026-07-08T13:00:00.000Z")
    };
    const deliveredDigestB: StoredDelivery = {
      ...deliveredDigestA,
      id: "delivered-digest-b",
      opsAlertId: watchAlertB.id
    };
    const { prisma, deliveries } = createPrismaStub([watchAlertA, watchAlertB], [deliveredDigestA, deliveredDigestB]);
    const transport = createDeliveryTransportStub({
      telegram: {
        status: "delivered",
        deliveryPath: "telegram_bot_api",
        providerMessageId: "tg-digest-resend-1",
        deliveredAt: new Date("2026-07-08T13:05:00.000Z"),
        metadata: {
          provider: "telegram_bot_api",
          chatId: "123456"
        }
      }
    });
    const store = createOpsAlertStore(prisma as never, {
      getRouteDecisionOpsSummary: async () => createOpsSummary(),
      deliveryTransport: transport
    });

    const listed = await store.resendDelivery(watchAlertA.id, deliveredDigestA.id, "admin-resend");

    expect(transport.calls).toHaveLength(1);
    expect(deliveries).toHaveLength(4);
    const resentDigestEntry = listed.find((delivery) => delivery.metadata.resendOfDeliveryId === "delivered-digest-a");
    expect(resentDigestEntry?.metadata).toMatchObject({
      replayType: "resend",
      replayOfBatchId: "digest-delivered-1",
      resendOfDeliveryId: "delivered-digest-a",
      resendCount: 1,
      resendGroupSize: 2
    });
    expect(deliveries.find((delivery) => delivery.id !== "delivered-digest-a" && delivery.id !== "delivered-digest-b" && delivery.opsAlertId === watchAlertB.id)?.providerMessageId).toBe(
      "tg-digest-resend-1"
    );
  });
});
