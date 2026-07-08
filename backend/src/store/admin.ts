import { randomUUID } from "node:crypto";

import type { PrismaClient, RouteReprobeJob } from "../generated/prisma/client.js";
import { SubscriptionStatus, UserStatus } from "../generated/prisma/client.js";
import type {
  AdminUserSummary,
  RouteDecisionOpsEndpointSummary,
  RouteDecisionOpsEventSummary,
  RouteDecisionOpsNetworkSummary,
  RouteDecisionOpsSummary,
  RouteReprobeExecutionSummary,
  RouteReprobeJobAttemptAuditEntry,
  RouteReprobeJobOpsSummary,
  TelemetryFailureReason,
  TelemetryNetworkContext
} from "../types.js";
import { summarizeInventoryHealth } from "../inventory-policy.js";
import {
  StoreAuthError,
  hashPassword,
  cloneDefaultState,
  mapUserRowToAdminUserSummary
} from "./utils.js";
import { loadAdminUsers } from "./shared.js";
import { mapRouteReprobeJobSummary } from "./route-reprobe-jobs.js";
import { computeOpsOverallSeverity, detectOpsAlerts } from "./ops-alert-detector.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asFailureReason(value: unknown): TelemetryFailureReason | null {
  return value === "timeout" ||
    value === "handshake_failed" ||
    value === "connect_refused" ||
    value === "dns_blocked" ||
    value === "captive_portal" ||
    value === "packet_loss_suspected" ||
    value === "tls_error" ||
    value === "unknown"
    ? value
    : null;
}

function readMetadataValue(metadata: unknown, key: string) {
  return isRecord(metadata) ? metadata[key] : undefined;
}

function readEventSource(metadata: unknown): RouteDecisionOpsEventSummary["source"] {
  const source = readMetadataValue(metadata, "source");
  return source === "resolve" || source === "connect" || source === "runtime_reprobe" || source === "manual_report"
    ? source
    : null;
}

function readNullableString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function readNullableNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function median(values: number[]) {
  if (!values.length) {
    return null;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const midpoint = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 1) {
    return sorted[midpoint];
  }

  return Number(((sorted[midpoint - 1] + sorted[midpoint]) / 2).toFixed(1));
}

function percentile(values: number[], ratio: number) {
  if (!values.length) {
    return null;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return sorted[index];
}

function minutesBetween(start: Date, end: Date) {
  return Number(((end.getTime() - start.getTime()) / 60000).toFixed(1));
}

const opsRetentionPolicy = {
  probeReportsDays: 45,
  routeEventsDays: 45,
  routeReprobeJobsDays: 14,
  routeSuccessRollupsDays: 180,
  routeRankingsDays: 180
} as const;

type RouteDecisionOpsEventRecord = {
  id: string;
  occurredAt: Date;
  endpointId: string | null;
  networkFingerprintId: string | null;
  eventType: string;
  feedbackResult: string | null;
  eventReason: string | null;
  metadata: unknown;
  transportProfile: string;
  endpoint: {
    id: string;
    label: string;
    provider: string;
    asn: number | null;
    transportProfile: string;
    city: string | null;
    countryCode: string;
    serverPool: {
      region: string | null;
    } | null;
  } | null;
  networkFingerprint: {
    id: string;
    networkType: string | null;
    carrier: string | null;
    asn: number | null;
    countryCode: string | null;
    region: string | null;
  } | null;
};

type DegradationWindow = {
  endpointId: string | null;
  networkFingerprintId: string | null;
  networkContextKey: string;
  provider: string | null;
  endpointAsn: number | null;
  startedAt: Date;
  resolvedAt?: Date;
};

type InventoryEndpointRecord = {
  endpointId: string;
  provider: string;
  asn: number | null;
  poolCode: string;
  countryCode: string;
  region: string | null;
};

function parseAuditTimestamp(entry: RouteReprobeJobAttemptAuditEntry) {
  const timestamp = Date.parse(entry.at);
  return Number.isNaN(timestamp) ? null : new Date(timestamp);
}

function parseJobContext(job: RouteReprobeJob): TelemetryNetworkContext {
  if (!isRecord(job.context)) {
    return {
      networkType: undefined,
      carrier: undefined,
      asn: undefined,
      countryCode: undefined,
      region: undefined
    };
  }

  return {
    networkType:
      job.context.networkType === "wifi" || job.context.networkType === "mobile" || job.context.networkType === "unknown"
        ? job.context.networkType
        : undefined,
    carrier: typeof job.context.carrier === "string" ? job.context.carrier : undefined,
    asn: typeof job.context.asn === "number" ? job.context.asn : undefined,
    countryCode: typeof job.context.countryCode === "string" ? job.context.countryCode : undefined,
    region: typeof job.context.region === "string" ? job.context.region : undefined
  };
}

function compareIsoDesc(left: string | null, right: string | null) {
  return Date.parse(right ?? "1970-01-01T00:00:00.000Z") - Date.parse(left ?? "1970-01-01T00:00:00.000Z");
}

function buildRouteReprobeExecutionSummary(input: {
  jobs: RouteReprobeJob[];
  summaryLimit: number;
  routeEvents?: RouteDecisionOpsEventRecord[];
  degradationWindows?: DegradationWindow[];
  now?: Date;
}): RouteReprobeExecutionSummary {
  const now = input.now ?? new Date();
  const jobs = input.jobs.map(mapRouteReprobeJobSummary);
  const queuedJobs = jobs.filter((job) => job.status === "queued");
  const runningJobs = jobs.filter((job) => job.status === "running");
  const completedJobs = jobs.filter((job) => job.status === "completed");
  const deadLetterJobs = jobs.filter((job) => job.status === "dead_letter");
  const retryScheduledCount = jobs.reduce(
    (sum, job) => sum + job.attemptAudit.filter((entry) => entry.event === "retry_scheduled").length,
    0
  );
  const leaseReclaimedCount = jobs.reduce((sum, job) => sum + job.leaseReclaimedCount, 0);
  const overdueQueuedJobs = queuedJobs.filter((job) => job.nextAttemptAt && Date.parse(job.nextAttemptAt) <= now.getTime()).length;
  const staleRunningJobs = runningJobs.filter((job) => job.leaseExpiresAt && Date.parse(job.leaseExpiresAt) < now.getTime()).length;

  const timeToStartDurations: number[] = [];
  const lifecycleDurations: number[] = [];
  let latestWorkerActivityAt: string | null = null;
  let lastClaimedAt: string | null = null;
  let lastCompletedAt: string | null = null;
  const timeline: RouteReprobeExecutionSummary["timeline"] = [];
  const failureGroups = new Map<
    string,
    RouteReprobeExecutionSummary["failureDrilldown"][number] & { jobIds: Set<string> }
  >();
  const workerGroups = new Map<
    string,
    RouteReprobeExecutionSummary["workerHotspots"][number] & { failureKeysSet: Set<string>; jobIdsSet: Set<string> }
  >();
  const hotspotGroups = new Map<
    string,
    RouteReprobeExecutionSummary["networkHotspots"][number] & { failureCounts: Map<TelemetryFailureReason, number> }
  >();

  const recentJobs: RouteReprobeJobOpsSummary[] = [...jobs]
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
    .slice(0, input.summaryLimit)
    .map((job) => {
      const firstClaimed = job.attemptAudit.find((entry) => entry.event === "claimed");
      const latestAttempt = job.attemptAudit[job.attemptAudit.length - 1] ?? null;
      const timeToStartMinutes =
        firstClaimed && !Number.isNaN(Date.parse(firstClaimed.at))
          ? minutesBetween(new Date(job.createdAt), new Date(firstClaimed.at))
          : null;
      const lifecycleEnd =
        job.completedAt && !Number.isNaN(Date.parse(job.completedAt))
          ? new Date(job.completedAt)
          : job.status === "queued" || job.status === "running"
            ? now
            : null;
      const lifecycleMinutes = lifecycleEnd ? minutesBetween(new Date(job.createdAt), lifecycleEnd) : null;
      const rawJob = input.jobs.find((entry) => entry.id === job.id) ?? null;
      const jobContext = rawJob ? parseJobContext(rawJob) : {
        networkType: undefined,
        carrier: undefined,
        asn: undefined,
        countryCode: undefined,
        region: undefined
      };
      const jobNetworkKey = buildNetworkContextKey(jobContext);
      const relevantRouteEvents = (input.routeEvents ?? []).filter(
        (event) =>
          event.occurredAt.getTime() >= Date.parse(job.createdAt) &&
          buildNetworkContextKey({
            networkFingerprintId: event.networkFingerprintId,
            networkType: event.networkFingerprint?.networkType ?? null,
            carrier: event.networkFingerprint?.carrier ?? null,
            asn: event.networkFingerprint?.asn ?? null,
            countryCode: event.networkFingerprint?.countryCode ?? null,
            region: event.networkFingerprint?.region ?? null
          }) === jobNetworkKey
      );
      const feedbackEvents = relevantRouteEvents.filter(
        (event) =>
          event.eventType === "route_feedback" &&
          (event.feedbackResult === "connected" || event.feedbackResult === "unstable" || event.feedbackResult === "failed")
      );
      const failureCounts = new Map<TelemetryFailureReason, number>();
      for (const event of feedbackEvents) {
        const failureReason = asFailureReason(event.eventReason);
        if (failureReason) {
          failureCounts.set(failureReason, (failureCounts.get(failureReason) ?? 0) + 1);
        }
      }
      const allJobNetworkWindows = (input.degradationWindows ?? []).filter(
        (window) => window.networkContextKey === jobNetworkKey
      );
      const relevantWindows = allJobNetworkWindows.filter(
        (window) =>
          window.startedAt.getTime() >= Date.parse(job.createdAt)
      );
      const latestQualityEventAt = relevantRouteEvents.length
        ? relevantRouteEvents[relevantRouteEvents.length - 1]?.occurredAt.toISOString() ?? null
        : null;

      return {
        ...job,
        timeToStartMinutes,
        lifecycleMinutes,
        latestAttemptAt: latestAttempt?.at ?? null,
        latestAttemptEvent: latestAttempt?.event ?? null,
        qualityImpact: {
          feedbackEventsOnJobNetwork: feedbackEvents.length,
          connectedCountOnJobNetwork: feedbackEvents.filter((event) => event.feedbackResult === "connected").length,
          unstableCountOnJobNetwork: feedbackEvents.filter((event) => event.feedbackResult === "unstable").length,
          failedCountOnJobNetwork: feedbackEvents.filter((event) => event.feedbackResult === "failed").length,
          fallbackResolvesOnJobNetwork: relevantRouteEvents.filter(
            (event) =>
              event.eventType === "runtime_reprobe_resolve" &&
              isFallbackRecommendation(readNullableString(readMetadataValue(event.metadata, "recommendedReason")))
          ).length,
          degradationStartsOnJobNetwork: relevantWindows.length,
          activeDegradationOnJobNetwork: allJobNetworkWindows.some((window) => !window.resolvedAt),
          dominantFailureReasonOnJobNetwork:
            [...failureCounts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? null,
          latestQualityEventAt
        }
      };
    });

  for (const job of jobs) {
    const rawJob = input.jobs.find((entry) => entry.id === job.id) ?? null;
    const jobContext = rawJob ? parseJobContext(rawJob) : {};
    const jobNetworkKey = buildNetworkContextKey(jobContext);
    const hotspot = hotspotGroups.get(jobNetworkKey) ?? {
      networkKey: jobNetworkKey,
      network: jobContext,
      totalJobs: 0,
      queuedJobs: 0,
      runningJobs: 0,
      completedJobs: 0,
      deadLetterJobs: 0,
      activeDegradation: false,
      activeDegradationMinutes: null,
      feedbackEvents: 0,
      connectedCount: 0,
      unstableCount: 0,
      failedCount: 0,
      fallbackResolves: 0,
      latestJobAt: null,
      latestQualityEventAt: null,
      dominantFailureReason: null,
      sampleJobIds: [],
      failureCounts: new Map<TelemetryFailureReason, number>()
    };
    hotspot.totalJobs += 1;
    hotspot.queuedJobs += job.status === "queued" ? 1 : 0;
    hotspot.runningJobs += job.status === "running" ? 1 : 0;
    hotspot.completedJobs += job.status === "completed" ? 1 : 0;
    hotspot.deadLetterJobs += job.status === "dead_letter" ? 1 : 0;
    hotspot.latestJobAt =
      !hotspot.latestJobAt || Date.parse(job.createdAt) > Date.parse(hotspot.latestJobAt)
        ? job.createdAt
        : hotspot.latestJobAt;
    if (hotspot.sampleJobIds.length < 3) {
      hotspot.sampleJobIds.push(job.id);
    }
    hotspotGroups.set(jobNetworkKey, hotspot);

    for (const entry of job.attemptAudit) {
      timeline.push({
        at: entry.at,
        jobId: job.id,
        jobStatus: job.status,
        attempt: entry.attempt,
        event: entry.event,
        workerId: entry.workerId,
        message: entry.message,
        network: jobContext
      });

      if (entry.workerId) {
        const worker = workerGroups.get(entry.workerId) ?? {
          workerId: entry.workerId,
          activeJobs: 0,
          claimedJobs: 0,
          completedJobs: 0,
          deadLetterJobs: 0,
          retryScheduledCount: 0,
          failedEventCount: 0,
          leaseReclaimedCount: 0,
          staleRunningJobs: 0,
          latestActivityAt: null,
          lastClaimedAt: null,
          lastCompletedAt: null,
          sampleJobIds: [],
          failureKeys: [],
          failureKeysSet: new Set<string>(),
          jobIdsSet: new Set<string>()
        };
        worker.jobIdsSet.add(job.id);
        if (worker.sampleJobIds.length < 3 && !worker.sampleJobIds.includes(job.id)) {
          worker.sampleJobIds.push(job.id);
        }
        worker.latestActivityAt =
          !worker.latestActivityAt || Date.parse(entry.at) > Date.parse(worker.latestActivityAt)
            ? entry.at
            : worker.latestActivityAt;
        if (entry.event === "claimed") {
          worker.claimedJobs += 1;
          worker.lastClaimedAt =
            !worker.lastClaimedAt || Date.parse(entry.at) > Date.parse(worker.lastClaimedAt)
              ? entry.at
              : worker.lastClaimedAt;
        }
        if (entry.event === "completed") {
          worker.completedJobs += 1;
          worker.lastCompletedAt =
            !worker.lastCompletedAt || Date.parse(entry.at) > Date.parse(worker.lastCompletedAt)
              ? entry.at
              : worker.lastCompletedAt;
        }
        if (entry.event === "retry_scheduled") {
          worker.retryScheduledCount += 1;
        }
        if (entry.event === "failed") {
          worker.failedEventCount += 1;
        }
        if (entry.event === "lease_reclaimed") {
          worker.leaseReclaimedCount += 1;
        }
        if (entry.event === "dead_lettered") {
          worker.deadLetterJobs += 1;
        }
        if (
          entry.event === "failed" ||
          entry.event === "retry_scheduled" ||
          entry.event === "dead_lettered" ||
          entry.event === "lease_reclaimed"
        ) {
          const failureKey =
            entry.event === "lease_reclaimed"
              ? "lease_expired_before_completion"
              : readNullableString(entry.message) ?? entry.event;
          worker.failureKeysSet.add(failureKey);
        }
        workerGroups.set(entry.workerId, worker);
      }

      if (entry.event === "failed" || entry.event === "retry_scheduled" || entry.event === "dead_lettered" || entry.event === "lease_reclaimed") {
        const failureKey =
          entry.event === "lease_reclaimed"
            ? "lease_expired_before_completion"
            : readNullableString(entry.message) ?? entry.event;
        const existing = failureGroups.get(failureKey) ?? {
          failureKey,
          latestAt: entry.at,
          affectedJobs: 0,
          deadLetterJobs: 0,
          retryScheduledCount: 0,
          failedEventCount: 0,
          leaseReclaimedCount: 0,
          sampleJobIds: [],
          jobIds: new Set<string>()
        };
        existing.latestAt = Date.parse(entry.at) > Date.parse(existing.latestAt) ? entry.at : existing.latestAt;
        existing.jobIds.add(job.id);
        if (entry.event === "dead_lettered") {
          existing.deadLetterJobs += 1;
        }
        if (entry.event === "retry_scheduled") {
          existing.retryScheduledCount += 1;
        }
        if (entry.event === "failed") {
          existing.failedEventCount += 1;
        }
        if (entry.event === "lease_reclaimed") {
          existing.leaseReclaimedCount += 1;
        }
        failureGroups.set(failureKey, existing);
      }
    }

    const claimedEntries = job.attemptAudit.filter((entry) => entry.event === "claimed");
    const firstClaimed = claimedEntries[0];
    if (firstClaimed && !Number.isNaN(Date.parse(firstClaimed.at))) {
      timeToStartDurations.push(minutesBetween(new Date(job.createdAt), new Date(firstClaimed.at)));
    }
    const latestClaimed = claimedEntries[claimedEntries.length - 1];
    if (latestClaimed && !Number.isNaN(Date.parse(latestClaimed.at))) {
      lastClaimedAt =
        !lastClaimedAt || Date.parse(latestClaimed.at) > Date.parse(lastClaimedAt)
          ? latestClaimed.at
          : lastClaimedAt;
    }

    const completedEntry = [...job.attemptAudit].reverse().find((entry) => entry.event === "completed");
    if (completedEntry && !Number.isNaN(Date.parse(completedEntry.at))) {
      lastCompletedAt =
        !lastCompletedAt || Date.parse(completedEntry.at) > Date.parse(lastCompletedAt)
          ? completedEntry.at
          : lastCompletedAt;
    }

    const latestAuditDate = [...job.attemptAudit]
      .map(parseAuditTimestamp)
      .filter((value): value is Date => value instanceof Date)
      .sort((left, right) => right.getTime() - left.getTime())[0];
    if (latestAuditDate) {
      latestWorkerActivityAt =
        !latestWorkerActivityAt || latestAuditDate.getTime() > Date.parse(latestWorkerActivityAt)
          ? latestAuditDate.toISOString()
          : latestWorkerActivityAt;
    }

    const lifecycleEnd =
      job.completedAt && !Number.isNaN(Date.parse(job.completedAt))
        ? new Date(job.completedAt)
        : job.status === "queued" || job.status === "running"
          ? now
          : null;
    if (lifecycleEnd) {
      lifecycleDurations.push(minutesBetween(new Date(job.createdAt), lifecycleEnd));
    }
  }

  for (const hotspot of hotspotGroups.values()) {
    const relevantRouteEvents = (input.routeEvents ?? []).filter(
      (event) =>
        buildNetworkContextKey({
          networkFingerprintId: event.networkFingerprintId,
          networkType: event.networkFingerprint?.networkType ?? null,
          carrier: event.networkFingerprint?.carrier ?? null,
          asn: event.networkFingerprint?.asn ?? null,
          countryCode: event.networkFingerprint?.countryCode ?? null,
          region: event.networkFingerprint?.region ?? null
        }) === hotspot.networkKey
    );
    const feedbackEvents = relevantRouteEvents.filter(
      (event) =>
        event.eventType === "route_feedback" &&
        (event.feedbackResult === "connected" || event.feedbackResult === "unstable" || event.feedbackResult === "failed")
    );
    hotspot.feedbackEvents = feedbackEvents.length;
    hotspot.connectedCount = feedbackEvents.filter((event) => event.feedbackResult === "connected").length;
    hotspot.unstableCount = feedbackEvents.filter((event) => event.feedbackResult === "unstable").length;
    hotspot.failedCount = feedbackEvents.filter((event) => event.feedbackResult === "failed").length;
    hotspot.fallbackResolves = relevantRouteEvents.filter(
      (event) =>
        event.eventType === "runtime_reprobe_resolve" &&
        isFallbackRecommendation(readNullableString(readMetadataValue(event.metadata, "recommendedReason")))
    ).length;
    hotspot.latestQualityEventAt =
      relevantRouteEvents.length > 0 ? relevantRouteEvents[relevantRouteEvents.length - 1]?.occurredAt.toISOString() ?? null : null;

    for (const event of feedbackEvents) {
      const failureReason = asFailureReason(event.eventReason);
      if (failureReason) {
        hotspot.failureCounts.set(failureReason, (hotspot.failureCounts.get(failureReason) ?? 0) + 1);
      }
    }

    const matchingWindows = (input.degradationWindows ?? []).filter((window) => window.networkContextKey === hotspot.networkKey);
    const activeWindows = matchingWindows.filter((window) => !window.resolvedAt);
    hotspot.activeDegradation = activeWindows.length > 0;
    hotspot.activeDegradationMinutes =
      activeWindows.length > 0
        ? Math.max(...activeWindows.map((window) => minutesBetween(window.startedAt, now)))
        : null;
    hotspot.dominantFailureReason =
      [...hotspot.failureCounts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? null;
  }

  for (const job of runningJobs) {
    const latestWorkerId = job.attemptAudit[job.attemptAudit.length - 1]?.workerId;
    if (!latestWorkerId) {
      continue;
    }

    const worker = workerGroups.get(latestWorkerId);
    if (!worker) {
      continue;
    }

    worker.activeJobs += 1;
    if (job.leaseExpiresAt && Date.parse(job.leaseExpiresAt) < now.getTime()) {
      worker.staleRunningJobs += 1;
    }
  }

  const workerHotspots = [...workerGroups.values()]
    .map((worker) => ({
      workerId: worker.workerId,
      activeJobs: worker.activeJobs,
      claimedJobs: worker.claimedJobs,
      completedJobs: worker.completedJobs,
      deadLetterJobs: worker.deadLetterJobs,
      retryScheduledCount: worker.retryScheduledCount,
      failedEventCount: worker.failedEventCount,
      leaseReclaimedCount: worker.leaseReclaimedCount,
      staleRunningJobs: worker.staleRunningJobs,
      latestActivityAt: worker.latestActivityAt,
      lastClaimedAt: worker.lastClaimedAt,
      lastCompletedAt: worker.lastCompletedAt,
      sampleJobIds: worker.sampleJobIds,
      failureKeys: [...worker.failureKeysSet].slice(0, 3)
    }))
    .sort((left, right) => {
      if (right.deadLetterJobs !== left.deadLetterJobs) {
        return right.deadLetterJobs - left.deadLetterJobs;
      }
      if (right.staleRunningJobs !== left.staleRunningJobs) {
        return right.staleRunningJobs - left.staleRunningJobs;
      }
      if (right.retryScheduledCount !== left.retryScheduledCount) {
        return right.retryScheduledCount - left.retryScheduledCount;
      }
      return Date.parse(right.latestActivityAt ?? "1970-01-01T00:00:00.000Z") - Date.parse(left.latestActivityAt ?? "1970-01-01T00:00:00.000Z");
    })
    .slice(0, input.summaryLimit);
  const workerAlerts: RouteReprobeExecutionSummary["workerAlerts"] = [];

  for (const worker of workerHotspots) {
    if (worker.deadLetterJobs > 0) {
      workerAlerts.push({
        id: `worker-dead-letter:${worker.workerId}`,
        severity: "critical",
        workerId: worker.workerId,
        title: "Worker reached dead-letter jobs",
        detail: `${worker.deadLetterJobs} dead-letter job(s) and ${worker.failedEventCount} failed event(s) were attributed to this worker.`,
        latestActivityAt: worker.latestActivityAt
      });
      continue;
    }

    if (worker.staleRunningJobs > 0 || worker.leaseReclaimedCount > 0) {
      workerAlerts.push({
        id: `worker-stale:${worker.workerId}`,
        severity: worker.staleRunningJobs > 0 ? "critical" : "watch",
        workerId: worker.workerId,
        title: "Worker shows lease churn",
        detail: `${worker.staleRunningJobs} stale running job(s) and ${worker.leaseReclaimedCount} lease reclaim event(s) were observed on this worker.`,
        latestActivityAt: worker.latestActivityAt
      });
      continue;
    }

    if (worker.retryScheduledCount > 0 || worker.failedEventCount > 0) {
      workerAlerts.push({
        id: `worker-retries:${worker.workerId}`,
        severity: "watch",
        workerId: worker.workerId,
        title: "Worker accumulates retries",
        detail: `${worker.retryScheduledCount} retry schedule event(s) and ${worker.failedEventCount} failed attempt(s) were observed on this worker.`,
        latestActivityAt: worker.latestActivityAt
      });
    }
  }

  const sortedTimeline = timeline
    .sort((left, right) => Date.parse(right.at) - Date.parse(left.at));
  const sortedFailureDrilldown = [...failureGroups.values()]
    .map((group) => ({
      failureKey: group.failureKey,
      latestAt: group.latestAt,
      affectedJobs: group.jobIds.size,
      deadLetterJobs: group.deadLetterJobs,
      retryScheduledCount: group.retryScheduledCount,
      failedEventCount: group.failedEventCount,
      leaseReclaimedCount: group.leaseReclaimedCount,
      sampleJobIds: [...group.jobIds].slice(0, 3)
    }))
    .sort((left, right) => {
      if (right.deadLetterJobs !== left.deadLetterJobs) {
        return right.deadLetterJobs - left.deadLetterJobs;
      }
      if (right.failedEventCount !== left.failedEventCount) {
        return right.failedEventCount - left.failedEventCount;
      }
      return Date.parse(right.latestAt) - Date.parse(left.latestAt);
    });
  const sortedNetworkHotspots = [...hotspotGroups.values()]
    .map((hotspot) => ({
      networkKey: hotspot.networkKey,
      network: hotspot.network,
      totalJobs: hotspot.totalJobs,
      queuedJobs: hotspot.queuedJobs,
      runningJobs: hotspot.runningJobs,
      completedJobs: hotspot.completedJobs,
      deadLetterJobs: hotspot.deadLetterJobs,
      activeDegradation: hotspot.activeDegradation,
      activeDegradationMinutes: hotspot.activeDegradationMinutes,
      feedbackEvents: hotspot.feedbackEvents,
      connectedCount: hotspot.connectedCount,
      unstableCount: hotspot.unstableCount,
      failedCount: hotspot.failedCount,
      fallbackResolves: hotspot.fallbackResolves,
      latestJobAt: hotspot.latestJobAt,
      latestQualityEventAt: hotspot.latestQualityEventAt,
      dominantFailureReason: hotspot.dominantFailureReason,
      sampleJobIds: hotspot.sampleJobIds
    }))
    .sort((left, right) => {
      if (right.deadLetterJobs !== left.deadLetterJobs) {
        return right.deadLetterJobs - left.deadLetterJobs;
      }
      if (right.queuedJobs + right.runningJobs !== left.queuedJobs + left.runningJobs) {
        return right.queuedJobs + right.runningJobs - (left.queuedJobs + left.runningJobs);
      }
      if (right.failedCount !== left.failedCount) {
        return right.failedCount - left.failedCount;
      }
      return compareIsoDesc(left.latestJobAt, right.latestJobAt);
    });
  const prioritizedJobs = [...recentJobs].sort((left, right) => {
    const rank = (status: RouteReprobeJobOpsSummary["status"]) =>
      status === "dead_letter" ? 4 : status === "running" ? 3 : status === "queued" ? 2 : status === "failed" ? 1 : 0;
    const rankDiff = rank(right.status) - rank(left.status);
    if (rankDiff !== 0) {
      return rankDiff;
    }
    return compareIsoDesc(left.latestAttemptAt ?? left.createdAt, right.latestAttemptAt ?? right.createdAt);
  });

  const focusedWorkerSource =
    (workerAlerts.length ? workerHotspots.find((worker) => worker.workerId === workerAlerts[0]?.workerId) : null) ??
    workerHotspots[0] ??
    null;
  const focusedWorker = focusedWorkerSource
    ? {
      workerId: focusedWorkerSource.workerId,
      latestActivityAt: focusedWorkerSource.latestActivityAt,
      activeAlertCount: workerAlerts.filter((alert) => alert.workerId === focusedWorkerSource.workerId).length,
      activeJobs: focusedWorkerSource.activeJobs,
      deadLetterJobs: focusedWorkerSource.deadLetterJobs,
      staleRunningJobs: focusedWorkerSource.staleRunningJobs,
      retryScheduledCount: focusedWorkerSource.retryScheduledCount,
      failedEventCount: focusedWorkerSource.failedEventCount,
      leaseReclaimedCount: focusedWorkerSource.leaseReclaimedCount,
      sampleJobIds: focusedWorkerSource.sampleJobIds,
      recentTimeline: sortedTimeline
        .filter((entry) => entry.workerId === focusedWorkerSource.workerId)
        .slice(0, input.summaryLimit),
      relatedFailures: sortedFailureDrilldown
        .filter((failure) => failure.sampleJobIds.some((jobId) => focusedWorkerSource.sampleJobIds.includes(jobId)))
        .slice(0, 3)
    }
    : null;

  const focusedNetworkSource =
    sortedNetworkHotspots.find((hotspot) => hotspot.activeDegradation || hotspot.queuedJobs + hotspot.runningJobs > 0) ??
    sortedNetworkHotspots.find((hotspot) => hotspot.deadLetterJobs > 0) ??
    sortedNetworkHotspots[0] ??
    null;
  const focusedNetwork = focusedNetworkSource
    ? {
      networkKey: focusedNetworkSource.networkKey,
      network: focusedNetworkSource.network,
      queuedOrRunningJobs: focusedNetworkSource.queuedJobs + focusedNetworkSource.runningJobs,
      deadLetterJobs: focusedNetworkSource.deadLetterJobs,
      activeDegradation: focusedNetworkSource.activeDegradation,
      activeDegradationMinutes: focusedNetworkSource.activeDegradationMinutes,
      feedbackEvents: focusedNetworkSource.feedbackEvents,
      connectedCount: focusedNetworkSource.connectedCount,
      unstableCount: focusedNetworkSource.unstableCount,
      failedCount: focusedNetworkSource.failedCount,
      fallbackResolves: focusedNetworkSource.fallbackResolves,
      dominantFailureReason: focusedNetworkSource.dominantFailureReason,
      latestJobAt: focusedNetworkSource.latestJobAt,
      latestQualityEventAt: focusedNetworkSource.latestQualityEventAt,
      sampleJobIds: focusedNetworkSource.sampleJobIds,
      recentTimeline: sortedTimeline
        .filter((entry) => buildNetworkContextKey(entry.network) === focusedNetworkSource.networkKey)
        .slice(0, input.summaryLimit),
      relatedJobs: prioritizedJobs
        .filter((job) => buildNetworkContextKey(job.context) === focusedNetworkSource.networkKey)
        .slice(0, 3)
    }
    : null;

  const focusedJobSource = prioritizedJobs[0] ?? null;
  const focusedJob = focusedJobSource
    ? {
      job: focusedJobSource,
      relatedWorkerIds: [...new Set(
        focusedJobSource.attemptAudit
          .map((entry) => entry.workerId)
          .filter((value): value is string => Boolean(value))
      )].slice(0, 3),
      attemptTrail: sortedTimeline
        .filter((entry) => entry.jobId === focusedJobSource.id)
        .slice(0, input.summaryLimit),
      relatedFailures: sortedFailureDrilldown
        .filter((failure) => failure.sampleJobIds.includes(focusedJobSource.id))
        .slice(0, 3)
    }
    : null;

  return {
    totals: {
      totalJobs: jobs.length,
      queuedJobs: queuedJobs.length,
      runningJobs: runningJobs.length,
      completedJobs: completedJobs.length,
      deadLetterJobs: deadLetterJobs.length,
      retryScheduledCount,
      leaseReclaimedCount,
      overdueQueuedJobs,
      staleRunningJobs,
      completionRate: jobs.length > 0 ? completedJobs.length / jobs.length : 0,
      deadLetterRate: jobs.length > 0 ? deadLetterJobs.length / jobs.length : 0,
      retryRate: jobs.length > 0 ? retryScheduledCount / jobs.length : 0
    },
    timing: {
      averageTimeToStartMinutes:
        timeToStartDurations.length > 0
          ? Number((timeToStartDurations.reduce((sum, value) => sum + value, 0) / timeToStartDurations.length).toFixed(1))
          : null,
      medianTimeToStartMinutes: median(timeToStartDurations),
      p95TimeToStartMinutes: percentile(timeToStartDurations, 0.95),
      averageLifecycleMinutes:
        lifecycleDurations.length > 0
          ? Number((lifecycleDurations.reduce((sum, value) => sum + value, 0) / lifecycleDurations.length).toFixed(1))
          : null,
      medianLifecycleMinutes: median(lifecycleDurations),
      p95LifecycleMinutes: percentile(lifecycleDurations, 0.95),
      oldestQueuedAgeMinutes:
        queuedJobs.length > 0
          ? Math.max(...queuedJobs.map((job) => minutesBetween(new Date(job.createdAt), now)))
          : null,
      longestRunningAgeMinutes:
        runningJobs.length > 0
          ? Math.max(...runningJobs.map((job) => minutesBetween(new Date(job.createdAt), now)))
          : null
    },
    workerHealth: {
      activeWorkerCount: new Set(runningJobs.map((job) => job.attemptAudit[job.attemptAudit.length - 1]?.workerId).filter(Boolean)).size,
      latestWorkerActivityAt,
      lastClaimedAt,
      lastCompletedAt
    },
    recentJobs,
    timeline: sortedTimeline.slice(0, input.summaryLimit * 4),
    failureDrilldown: sortedFailureDrilldown.slice(0, input.summaryLimit),
    networkHotspots: sortedNetworkHotspots.slice(0, input.summaryLimit),
    workerAlerts: workerAlerts.slice(0, input.summaryLimit),
    workerHotspots,
    focusedDrilldowns: {
      worker: focusedWorker,
      network: focusedNetwork,
      job: focusedJob
    }
  };
}

function floorToWindow(date: Date, windowSizeMinutes: number) {
  const windowMs = windowSizeMinutes * 60 * 1000;
  return new Date(Math.floor(date.getTime() / windowMs) * windowMs);
}

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function buildNetworkContextKey(input: {
  networkFingerprintId?: string | null;
  networkType?: string | null;
  carrier?: string | null;
  asn?: number | null;
  countryCode?: string | null;
  region?: string | null;
}) {
  return [
    input.networkType ?? "unknown",
    input.carrier ?? "unknown",
    input.asn ?? "unknown",
    input.countryCode ?? "unknown",
    input.region ?? "unknown"
  ].join(":");
}

function isFallbackRecommendation(reason: string | null) {
  return Boolean(reason && reason !== "network_ranking_primary" && reason !== "manual_override");
}

function formatDomainLabel(domainType: "provider" | "asn", domainKey: string) {
  return domainType === "provider" ? domainKey : `ASN ${domainKey}`;
}

export function buildRouteDecisionOpsSummary(input: {
  routeEvents: RouteDecisionOpsEventRecord[];
  routeReprobeJobs: RouteReprobeJob[];
  endpointInventory?: InventoryEndpointRecord[];
  windowHours: number;
  recentLimit: number;
  summaryLimit: number;
  now?: Date;
}): RouteDecisionOpsSummary {
  const now = input.now ?? new Date();
  const feedbackEvents = input.routeEvents.filter(
    (event) =>
      event.eventType === "route_feedback" &&
      (event.feedbackResult === "connected" || event.feedbackResult === "unstable" || event.feedbackResult === "failed")
  );
  const connectedCount = feedbackEvents.filter((event) => event.feedbackResult === "connected").length;
  const unstableCount = feedbackEvents.filter((event) => event.feedbackResult === "unstable").length;
  const failedCount = feedbackEvents.filter((event) => event.feedbackResult === "failed").length;
  const uniqueEndpoints = new Set(feedbackEvents.map((event) => event.endpointId).filter((value): value is string => Boolean(value))).size;
  const uniqueNetworks = new Set(
    feedbackEvents.map((event) => event.networkFingerprintId).filter((value): value is string => Boolean(value))
  ).size;
  const inventoryRecords = input.endpointInventory ?? [];
  const inferredInventory =
    inventoryRecords.length > 0
      ? inventoryRecords
      : [...new Map(
          input.routeEvents
            .filter((event): event is RouteDecisionOpsEventRecord & { endpointId: string; endpoint: NonNullable<RouteDecisionOpsEventRecord["endpoint"]> } =>
              Boolean(event.endpointId && event.endpoint)
            )
            .map((event) => [
              event.endpointId,
              {
                endpointId: event.endpointId,
                provider: event.endpoint.provider,
                asn: event.endpoint.asn ?? null,
                poolCode: event.endpoint.serverPool?.region
                  ? `${event.endpoint.provider}:${event.endpoint.serverPool.region}:${event.endpoint.asn ?? "na"}`
                  : `${event.endpoint.provider}:${event.endpoint.city ?? event.endpoint.countryCode}:${event.endpoint.asn ?? "na"}`,
                countryCode: event.endpoint.countryCode,
                region: event.endpoint.serverPool?.region ?? event.endpoint.city ?? event.endpoint.countryCode
              }
            ])
        ).values()];
  const inventoryHealth = summarizeInventoryHealth(inferredInventory);

  const endpointGroups = new Map<
    string,
    RouteDecisionOpsEndpointSummary & { failureCounts: Map<TelemetryFailureReason, number> }
  >();
  const networkGroups = new Map<string, RouteDecisionOpsNetworkSummary>();
  const recentEvents: RouteDecisionOpsEventSummary[] = input.routeEvents
    .slice(-input.recentLimit)
    .reverse()
    .map((event) => ({
      id: event.id,
      occurredAt: event.occurredAt.toISOString(),
      endpointId: event.endpointId,
      endpointLabel: event.endpoint?.label ?? null,
      endpointRegion: event.endpoint ? event.endpoint.serverPool?.region ?? event.endpoint.city ?? event.endpoint.countryCode : null,
      provider: event.endpoint?.provider ?? null,
      transportProfile: event.transportProfile,
      feedbackResult:
        event.feedbackResult === "connected" || event.feedbackResult === "unstable" || event.feedbackResult === "failed"
          ? event.feedbackResult
          : null,
      failureReason: asFailureReason(event.eventReason),
      networkFingerprintId: event.networkFingerprintId,
      networkType: event.networkFingerprint?.networkType ?? null,
      carrier: event.networkFingerprint?.carrier ?? null,
      asn: event.networkFingerprint?.asn ?? null,
      countryCode: event.networkFingerprint?.countryCode ?? null,
      region: event.networkFingerprint?.region ?? null,
      source: readEventSource(event.metadata),
      latencyMs: readNullableNumber(readMetadataValue(event.metadata, "latencyMs")),
      appVersion: readNullableString(readMetadataValue(event.metadata, "appVersion")),
      note: readNullableString(readMetadataValue(event.metadata, "note")) ?? readNullableString(event.eventReason)
    }));

  const activeWindows = new Map<string, DegradationWindow>();
  const completedWindows: DegradationWindow[] = [];
  const allWindows: DegradationWindow[] = [];

  for (const event of feedbackEvents) {
    if (event.endpointId) {
      const existing = endpointGroups.get(event.endpointId) ?? {
        endpointId: event.endpointId,
        label: event.endpoint?.label ?? event.endpointId,
        region: event.endpoint ? event.endpoint.serverPool?.region ?? event.endpoint.city ?? event.endpoint.countryCode : "Unknown",
        provider: event.endpoint?.provider ?? "Unknown",
        transportProfile: event.transportProfile,
        feedbackEvents: 0,
        connectedCount: 0,
        unstableCount: 0,
        failedCount: 0,
        successRate: 0,
        lastEventAt: event.occurredAt.toISOString(),
        dominantFailureReason: null,
        failureCounts: new Map<TelemetryFailureReason, number>()
      };

      existing.feedbackEvents += 1;
      existing.connectedCount += event.feedbackResult === "connected" ? 1 : 0;
      existing.unstableCount += event.feedbackResult === "unstable" ? 1 : 0;
      existing.failedCount += event.feedbackResult === "failed" ? 1 : 0;
      existing.lastEventAt = event.occurredAt.toISOString();

      const failureReason = asFailureReason(event.eventReason);
      if (failureReason) {
        existing.failureCounts.set(failureReason, (existing.failureCounts.get(failureReason) ?? 0) + 1);
      }

      endpointGroups.set(event.endpointId, existing);
    }

    const networkKey = event.networkFingerprintId ?? [
      event.networkFingerprint?.networkType ?? "unknown",
      event.networkFingerprint?.carrier ?? "unknown",
      event.networkFingerprint?.asn ?? "unknown",
      event.networkFingerprint?.countryCode ?? "unknown",
      event.networkFingerprint?.region ?? "unknown"
    ].join(":");
    const network = networkGroups.get(networkKey) ?? {
      networkFingerprintId: event.networkFingerprintId,
      networkType: event.networkFingerprint?.networkType ?? null,
      carrier: event.networkFingerprint?.carrier ?? null,
      asn: event.networkFingerprint?.asn ?? null,
      countryCode: event.networkFingerprint?.countryCode ?? null,
      region: event.networkFingerprint?.region ?? null,
      feedbackEvents: 0,
      connectedCount: 0,
      unstableCount: 0,
      failedCount: 0,
      successRate: 0,
      lastEventAt: event.occurredAt.toISOString()
    };

    network.feedbackEvents += 1;
    network.connectedCount += event.feedbackResult === "connected" ? 1 : 0;
    network.unstableCount += event.feedbackResult === "unstable" ? 1 : 0;
    network.failedCount += event.feedbackResult === "failed" ? 1 : 0;
    network.lastEventAt = event.occurredAt.toISOString();
    networkGroups.set(networkKey, network);

    const streamKey = `${event.endpointId ?? "unknown"}::${event.networkFingerprintId ?? "unknown"}`;
    const isDegraded = event.feedbackResult === "unstable" || event.feedbackResult === "failed";
    const activeWindow = activeWindows.get(streamKey);

    if (isDegraded && !activeWindow) {
      const startedWindow: DegradationWindow = {
        endpointId: event.endpointId,
        networkFingerprintId: event.networkFingerprintId,
        networkContextKey: buildNetworkContextKey({
          networkFingerprintId: event.networkFingerprintId,
          networkType: event.networkFingerprint?.networkType ?? null,
          carrier: event.networkFingerprint?.carrier ?? null,
          asn: event.networkFingerprint?.asn ?? null,
          countryCode: event.networkFingerprint?.countryCode ?? null,
          region: event.networkFingerprint?.region ?? null
        }),
        provider: event.endpoint?.provider ?? null,
        endpointAsn: event.endpoint?.asn ?? null,
        startedAt: event.occurredAt
      };
      activeWindows.set(streamKey, startedWindow);
      allWindows.push(startedWindow);
    }

    if (event.feedbackResult === "connected" && activeWindow) {
      activeWindow.resolvedAt = event.occurredAt;
      completedWindows.push(activeWindow);
      activeWindows.delete(streamKey);
    }
  }

  const endpoints = [...endpointGroups.values()]
    .map((endpoint) => {
      const dominantFailureReason = [...endpoint.failureCounts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? null;
      const { failureCounts, ...summary } = endpoint;
      return {
        ...summary,
        successRate: summary.feedbackEvents > 0 ? summary.connectedCount / summary.feedbackEvents : 0,
        dominantFailureReason
      };
    })
    .sort((left, right) => {
      if (right.failedCount !== left.failedCount) {
        return right.failedCount - left.failedCount;
      }
      if (right.unstableCount !== left.unstableCount) {
        return right.unstableCount - left.unstableCount;
      }
      return left.successRate - right.successRate;
    })
    .slice(0, input.summaryLimit);

  const networks = [...networkGroups.values()]
    .map((network) => ({
      ...network,
      successRate: network.feedbackEvents > 0 ? network.connectedCount / network.feedbackEvents : 0
    }))
    .sort((left, right) => {
      if (left.successRate !== right.successRate) {
        return left.successRate - right.successRate;
      }
      return right.failedCount - left.failedCount;
    })
    .slice(0, input.summaryLimit);

  const fallbackSnapshots = input.routeEvents.filter((event) => event.eventType === "runtime_reprobe_resolve");
  const fallbackReasons = new Map<string, number>();
  let fallbackCount = 0;
  let lastFallbackAt: string | null = null;

  const providerPressureGroups = new Map<
    string,
    {
      observationCount: number;
      fallbackCount: number;
      endpointIds: Set<string>;
      lastTriggeredAt: string | null;
    }
  >();
  const asnPressureGroups = new Map<
    string,
    {
      observationCount: number;
      fallbackCount: number;
      endpointIds: Set<string>;
      lastTriggeredAt: string | null;
    }
  >();

  for (const event of fallbackSnapshots) {
    const recommendedReason = readNullableString(readMetadataValue(event.metadata, "recommendedReason"));
    const isFallback = isFallbackRecommendation(recommendedReason);

    if (isFallback) {
      fallbackCount += 1;
      fallbackReasons.set(recommendedReason as string, (fallbackReasons.get(recommendedReason as string) ?? 0) + 1);
      lastFallbackAt = event.occurredAt.toISOString();
    }

    const providerKey = readNullableString(event.endpoint?.provider);
    if (providerKey) {
      const pressure = providerPressureGroups.get(providerKey) ?? {
        observationCount: 0,
        fallbackCount: 0,
        endpointIds: new Set<string>(),
        lastTriggeredAt: null
      };
      pressure.observationCount += 1;
      if (event.endpointId) {
        pressure.endpointIds.add(event.endpointId);
      }
      if (isFallback) {
        pressure.fallbackCount += 1;
        pressure.lastTriggeredAt = event.occurredAt.toISOString();
      }
      providerPressureGroups.set(providerKey, pressure);
    }

    const endpointAsn = event.endpoint?.asn;
    if (typeof endpointAsn === "number") {
      const asnKey = String(endpointAsn);
      const pressure = asnPressureGroups.get(asnKey) ?? {
        observationCount: 0,
        fallbackCount: 0,
        endpointIds: new Set<string>(),
        lastTriggeredAt: null
      };
      pressure.observationCount += 1;
      if (event.endpointId) {
        pressure.endpointIds.add(event.endpointId);
      }
      if (isFallback) {
        pressure.fallbackCount += 1;
        pressure.lastTriggeredAt = event.occurredAt.toISOString();
      }
      asnPressureGroups.set(asnKey, pressure);
    }
  }

  const activeWindowList = [...activeWindows.values()];
  const activeDegradedNetworkKeys = new Set(activeWindowList.map((window) => window.networkContextKey));
  const longestActiveMinutes =
    activeWindowList.length > 0
      ? Math.max(...activeWindowList.map((window) => minutesBetween(window.startedAt, now)))
      : null;
  const recoveryDurations = completedWindows
    .filter((window) => window.resolvedAt)
    .map((window) => minutesBetween(window.startedAt, window.resolvedAt as Date));

  const slaWindowSizeMinutes = 60;
  const slaAvailabilityTarget = 0.85;
  const slaWindowGroups = new Map<
    string,
    {
      startedAt: Date;
      feedbackEvents: number;
      connectedCount: number;
    }
  >();

  for (const event of feedbackEvents) {
    const startedAt = floorToWindow(event.occurredAt, slaWindowSizeMinutes);
    const key = startedAt.toISOString();
    const current = slaWindowGroups.get(key) ?? {
      startedAt,
      feedbackEvents: 0,
      connectedCount: 0
    };
    current.feedbackEvents += 1;
    current.connectedCount += event.feedbackResult === "connected" ? 1 : 0;
    slaWindowGroups.set(key, current);
  }

  const slaWindows = [...slaWindowGroups.values()]
    .map((window) => ({
      ...window,
      availability: window.feedbackEvents > 0 ? window.connectedCount / window.feedbackEvents : 0
    }))
    .sort((left, right) => left.startedAt.getTime() - right.startedAt.getTime());
  const breachedSlaWindows = slaWindows.filter((window) => window.availability < slaAvailabilityTarget);
  const historyWindowSizeMinutes = 60;
  const historyWindowGroups = new Map<
    string,
    {
      startedAt: Date;
      endedAt: Date;
      feedbackEvents: number;
      connectedCount: number;
      unstableCount: number;
      failedCount: number;
      fallbackResolves: number;
      queuedJobs: number;
      completedJobs: number;
      deadLetterJobs: number;
    }
  >();

  const ensureHistoryWindow = (date: Date) => {
    const startedAt = floorToWindow(date, historyWindowSizeMinutes);
    const key = startedAt.toISOString();
    const existing = historyWindowGroups.get(key);
    if (existing) {
      return existing;
    }

    const created = {
      startedAt,
      endedAt: addMinutes(startedAt, historyWindowSizeMinutes),
      feedbackEvents: 0,
      connectedCount: 0,
      unstableCount: 0,
      failedCount: 0,
      fallbackResolves: 0,
      queuedJobs: 0,
      completedJobs: 0,
      deadLetterJobs: 0
    };
    historyWindowGroups.set(key, created);
    return created;
  };

  for (const event of feedbackEvents) {
    const historyWindow = ensureHistoryWindow(event.occurredAt);
    historyWindow.feedbackEvents += 1;
    historyWindow.connectedCount += event.feedbackResult === "connected" ? 1 : 0;
    historyWindow.unstableCount += event.feedbackResult === "unstable" ? 1 : 0;
    historyWindow.failedCount += event.feedbackResult === "failed" ? 1 : 0;
  }

  for (const event of fallbackSnapshots) {
    const reason = readNullableString(readMetadataValue(event.metadata, "recommendedReason"));
    if (!isFallbackRecommendation(reason)) {
      continue;
    }

    const historyWindow = ensureHistoryWindow(event.occurredAt);
    historyWindow.fallbackResolves += 1;
  }

  for (const job of input.routeReprobeJobs) {
    const queuedWindow = ensureHistoryWindow(job.createdAt);
    queuedWindow.queuedJobs += 1;

    if (job.completedAt) {
      const completedWindow = ensureHistoryWindow(job.completedAt);
      completedWindow.completedJobs += 1;
    }

    if (job.deadLetteredAt) {
      const deadLetterWindow = ensureHistoryWindow(job.deadLetteredAt);
      deadLetterWindow.deadLetterJobs += 1;
    }
  }

  let currentHealthyStreak = 0;
  for (let index = slaWindows.length - 1; index >= 0; index -= 1) {
    if (slaWindows[index].availability >= slaAvailabilityTarget) {
      currentHealthyStreak += 1;
      continue;
    }

    break;
  }

  const recoveryGroups = new Map<
    string,
    {
      domainType: "provider" | "asn";
      domainKey: string;
      label: string;
      activeWindows: number;
      resolvedWindows: number;
      durations: number[];
      lastRecoveredAt: string | null;
    }
  >();

  const addRecoveryWindow = (domainType: "provider" | "asn", domainKey: string | null, window: DegradationWindow) => {
    if (!domainKey) {
      return;
    }

    const key = `${domainType}:${domainKey}`;
    const current = recoveryGroups.get(key) ?? {
      domainType,
      domainKey,
      label: formatDomainLabel(domainType, domainKey),
      activeWindows: 0,
      resolvedWindows: 0,
      durations: [],
      lastRecoveredAt: null
    };

    if (window.resolvedAt) {
      current.resolvedWindows += 1;
      current.durations.push(minutesBetween(window.startedAt, window.resolvedAt));
      current.lastRecoveredAt = window.resolvedAt.toISOString();
    } else {
      current.activeWindows += 1;
    }

    recoveryGroups.set(key, current);
  };

  for (const window of allWindows) {
    addRecoveryWindow("provider", window.provider, window);
    addRecoveryWindow("asn", typeof window.endpointAsn === "number" ? String(window.endpointAsn) : null, window);
  }

  const mapPressureGroups = (
    domainType: "provider" | "asn",
    groups: Map<string, { observationCount: number; fallbackCount: number; endpointIds: Set<string>; lastTriggeredAt: string | null }>
  ) =>
    [...groups.entries()]
      .map(([domainKey, pressure]) => ({
        domainType,
        domainKey,
        label: formatDomainLabel(domainType, domainKey),
        observationCount: pressure.observationCount,
        fallbackCount: pressure.fallbackCount,
        fallbackRate: pressure.observationCount > 0 ? pressure.fallbackCount / pressure.observationCount : 0,
        affectedEndpoints: pressure.endpointIds.size,
        lastTriggeredAt: pressure.lastTriggeredAt
      }))
      .filter((pressure) => pressure.observationCount > 0)
      .sort((left, right) => {
        if (right.fallbackCount !== left.fallbackCount) {
          return right.fallbackCount - left.fallbackCount;
        }
        if (right.fallbackRate !== left.fallbackRate) {
          return right.fallbackRate - left.fallbackRate;
        }
        return left.label.localeCompare(right.label);
      })
      .slice(0, input.summaryLimit);

  const recoveryByFailureDomain = [...recoveryGroups.values()]
    .map((recovery) => ({
      domainType: recovery.domainType,
      domainKey: recovery.domainKey,
      label: recovery.label,
      activeWindows: recovery.activeWindows,
      resolvedWindows: recovery.resolvedWindows,
      averageRecoveryMinutes:
        recovery.durations.length > 0
          ? Number((recovery.durations.reduce((sum, value) => sum + value, 0) / recovery.durations.length).toFixed(1))
          : null,
      medianRecoveryMinutes: median(recovery.durations),
      lastRecoveredAt: recovery.lastRecoveredAt
    }))
    .sort((left, right) => {
      if (right.activeWindows !== left.activeWindows) {
        return right.activeWindows - left.activeWindows;
      }
      if (right.resolvedWindows !== left.resolvedWindows) {
        return right.resolvedWindows - left.resolvedWindows;
      }
      return (right.averageRecoveryMinutes ?? -1) - (left.averageRecoveryMinutes ?? -1);
    })
    .slice(0, input.summaryLimit);

  const routeReprobeExecution = buildRouteReprobeExecutionSummary({
    jobs: input.routeReprobeJobs,
    summaryLimit: input.summaryLimit,
    routeEvents: input.routeEvents,
    degradationWindows: allWindows,
    now
  });
  const lastSuccessfulCompletionAt = routeReprobeExecution.workerHealth.lastCompletedAt;
  const lastSuccessfulCompletionDate =
    lastSuccessfulCompletionAt && !Number.isNaN(Date.parse(lastSuccessfulCompletionAt))
      ? new Date(lastSuccessfulCompletionAt)
      : null;
  const qualityEventsSinceLastSuccessfulCompletion = feedbackEvents.filter(
    (event) => !lastSuccessfulCompletionDate || event.occurredAt.getTime() > lastSuccessfulCompletionDate.getTime()
  ).length;
  const fallbackResolvesSinceLastSuccessfulCompletion = fallbackSnapshots.filter(
    (event) => !lastSuccessfulCompletionDate || event.occurredAt.getTime() > lastSuccessfulCompletionDate.getTime()
  ).length;
  const degradationStartsSinceLastSuccessfulCompletion = allWindows.filter(
    (window) => !lastSuccessfulCompletionDate || window.startedAt.getTime() > lastSuccessfulCompletionDate.getTime()
  ).length;
  const impactedJobs = input.routeReprobeJobs.filter((job) =>
    activeDegradedNetworkKeys.has(
      buildNetworkContextKey({
        networkType: isRecord(job.context) && typeof job.context.networkType === "string" ? job.context.networkType : null,
        carrier: isRecord(job.context) && typeof job.context.carrier === "string" ? job.context.carrier : null,
        asn: isRecord(job.context) && typeof job.context.asn === "number" ? job.context.asn : null,
        countryCode: isRecord(job.context) && typeof job.context.countryCode === "string" ? job.context.countryCode : null,
        region: isRecord(job.context) && typeof job.context.region === "string" ? job.context.region : null
      })
    )
  );
  const queuedOrRunningJobsOnActiveDegradedNetworks = impactedJobs.filter(
    (job) => job.status === "queued" || job.status === "running"
  ).length;
  const deadLetterJobsOnActiveDegradedNetworks = impactedJobs.filter((job) => job.status === "dead_letter").length;
  const executionImpactAttentionLevel =
    activeWindowList.length > 0 &&
    (deadLetterJobsOnActiveDegradedNetworks > 0 || routeReprobeExecution.totals.staleRunningJobs > 0)
      ? "critical"
      : activeWindowList.length > 0 &&
          (
            queuedOrRunningJobsOnActiveDegradedNetworks > 0 ||
            routeReprobeExecution.totals.overdueQueuedJobs > 0 ||
            qualityEventsSinceLastSuccessfulCompletion > 0
          )
        ? "watch"
        : "stable";
  const alerts = detectOpsAlerts({
    deadLetterJobs: routeReprobeExecution.totals.deadLetterJobs,
    staleRunningJobs: routeReprobeExecution.totals.staleRunningJobs,
    overdueQueuedJobs: routeReprobeExecution.totals.overdueQueuedJobs,
    executionImpactAttentionLevel,
    qualityEventsSinceLastSuccessfulCompletion,
    fallbackResolvesSinceLastSuccessfulCompletion,
    degradationStartsSinceLastSuccessfulCompletion,
    breachedSlaWindowCount: breachedSlaWindows.length,
    totalSlaWindowCount: slaWindows.length,
    slaAvailabilityTarget,
    inventoryRiskLevel: inventoryHealth.riskLevel,
    distinctInventoryProviders: inventoryHealth.distinctProviders,
    distinctInventoryAsns: inventoryHealth.distinctAsns,
    distinctInventoryRegions: inventoryHealth.distinctRegions,
    activeInventoryEndpoints: inventoryHealth.activeEndpoints,
    largestRegionalDomainSize: inventoryHealth.largestRegionalDomainSize,
    minimumRecommendedFailureDomains: inventoryHealth.minimumRecommendedFailureDomains,
    inventoryFailedDimensions: inventoryHealth.failedDimensions,
    inventoryPolicyViolationMessage: inventoryHealth.policyViolationMessage
  });

  const overallSeverity = computeOpsOverallSeverity(alerts);
  const history = [...historyWindowGroups.values()]
    .sort((left, right) => left.startedAt.getTime() - right.startedAt.getTime())
    .slice(-input.summaryLimit)
    .map((window) => {
      const severity: RouteDecisionOpsSummary["operationalSummary"]["history"][number]["severity"] =
        window.deadLetterJobs > 0 || window.failedCount >= 2
          ? "critical"
          : window.failedCount > 0 || window.unstableCount > 0 || window.fallbackResolves > 0 || window.queuedJobs > 0
            ? "watch"
            : "ok";

      return {
        startedAt: window.startedAt.toISOString(),
        endedAt: window.endedAt.toISOString(),
        severity,
        feedbackEvents: window.feedbackEvents,
        connectedCount: window.connectedCount,
        unstableCount: window.unstableCount,
        failedCount: window.failedCount,
        fallbackResolves: window.fallbackResolves,
        queuedJobs: window.queuedJobs,
        completedJobs: window.completedJobs,
        deadLetterJobs: window.deadLetterJobs
      };
    });
  const dailyHistoryGroups = new Map<
    string,
    {
      startedAt: Date;
      endedAt: Date;
      hourlyWindows: number;
      feedbackEvents: number;
      connectedCount: number;
      unstableCount: number;
      failedCount: number;
      fallbackResolves: number;
      queuedJobs: number;
      completedJobs: number;
      deadLetterJobs: number;
    }
  >();

  for (const window of historyWindowGroups.values()) {
    const startedAt = floorToWindow(window.startedAt, 24 * 60);
    const key = startedAt.toISOString();
    const current = dailyHistoryGroups.get(key) ?? {
      startedAt,
      endedAt: addMinutes(startedAt, 24 * 60),
      hourlyWindows: 0,
      feedbackEvents: 0,
      connectedCount: 0,
      unstableCount: 0,
      failedCount: 0,
      fallbackResolves: 0,
      queuedJobs: 0,
      completedJobs: 0,
      deadLetterJobs: 0
    };
    current.hourlyWindows += 1;
    current.feedbackEvents += window.feedbackEvents;
    current.connectedCount += window.connectedCount;
    current.unstableCount += window.unstableCount;
    current.failedCount += window.failedCount;
    current.fallbackResolves += window.fallbackResolves;
    current.queuedJobs += window.queuedJobs;
    current.completedJobs += window.completedJobs;
    current.deadLetterJobs += window.deadLetterJobs;
    dailyHistoryGroups.set(key, current);
  }
  const dailyHistory = [...dailyHistoryGroups.values()]
    .sort((left, right) => left.startedAt.getTime() - right.startedAt.getTime())
    .slice(-Math.max(input.summaryLimit, 3))
    .map((window) => {
      const severity: RouteDecisionOpsSummary["operationalSummary"]["dailyHistory"][number]["severity"] =
        window.deadLetterJobs > 0 || window.failedCount >= 3
          ? "critical"
          : window.failedCount > 0 || window.unstableCount > 0 || window.fallbackResolves > 0 || window.queuedJobs > 0
            ? "watch"
            : "ok";

      return {
        startedAt: window.startedAt.toISOString(),
        endedAt: window.endedAt.toISOString(),
        severity,
        hourlyWindows: window.hourlyWindows,
        feedbackEvents: window.feedbackEvents,
        connectedCount: window.connectedCount,
        unstableCount: window.unstableCount,
        failedCount: window.failedCount,
        fallbackResolves: window.fallbackResolves,
        queuedJobs: window.queuedJobs,
        completedJobs: window.completedJobs,
        deadLetterJobs: window.deadLetterJobs
      };
    });

  return {
    generatedAt: now.toISOString(),
    windowHours: input.windowHours,
    totals: {
      feedbackEvents: feedbackEvents.length,
      connectedCount,
      unstableCount,
      failedCount,
      successRate: feedbackEvents.length > 0 ? connectedCount / feedbackEvents.length : 0,
      uniqueEndpoints,
      uniqueNetworks
    },
    operationalSummary: {
      overallSeverity,
      activeAlertCount: alerts.length,
      alerts,
      inventoryHealth: {
        riskLevel: inventoryHealth.riskLevel,
        activeEndpoints: inventoryHealth.activeEndpoints,
        distinctProviders: inventoryHealth.distinctProviders,
        distinctAsns: inventoryHealth.distinctAsns,
        distinctPools: inventoryHealth.distinctPools,
        distinctRegions: inventoryHealth.distinctRegions,
        largestRegionalDomainSize: inventoryHealth.largestRegionalDomainSize,
        minimumRecommendedFailureDomains: inventoryHealth.minimumRecommendedFailureDomains,
        failedDimensions: inventoryHealth.failedDimensions,
        policyViolationMessage: inventoryHealth.policyViolationMessage
      },
      retention: opsRetentionPolicy,
      history,
      dailyHistory
    },
    qualityMetrics: {
      fallbackPressure: {
        observationCount: fallbackSnapshots.length,
        fallbackCount,
        fallbackRate: fallbackSnapshots.length > 0 ? fallbackCount / fallbackSnapshots.length : 0,
        dominantFallbackReason: [...fallbackReasons.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? null,
        lastTriggeredAt: lastFallbackAt
      },
      degradationWindows: {
        total: allWindows.length,
        active: activeWindowList.length,
        resolved: completedWindows.length,
        affectedEndpoints: new Set(allWindows.map((window) => window.endpointId).filter(Boolean)).size,
        affectedNetworks: new Set(allWindows.map((window) => window.networkFingerprintId).filter(Boolean)).size,
        longestActiveMinutes,
        lastStartedAt: allWindows[allWindows.length - 1]?.startedAt.toISOString() ?? null
      },
      recoveryTime: {
        resolvedWindowCount: completedWindows.length,
        averageMinutes:
          recoveryDurations.length > 0
            ? Number((recoveryDurations.reduce((sum, value) => sum + value, 0) / recoveryDurations.length).toFixed(1))
            : null,
        medianMinutes: median(recoveryDurations),
        lastRecoveredAt:
          completedWindows.length > 0
            ? completedWindows[completedWindows.length - 1].resolvedAt?.toISOString() ?? null
            : null
      },
      slaWindows: {
        windowSizeMinutes: slaWindowSizeMinutes,
        availabilityTarget: slaAvailabilityTarget,
        total: slaWindows.length,
        healthy: slaWindows.length - breachedSlaWindows.length,
        breached: breachedSlaWindows.length,
        breachRate: slaWindows.length > 0 ? breachedSlaWindows.length / slaWindows.length : 0,
        currentHealthyStreak,
        lastBreachAt: breachedSlaWindows[breachedSlaWindows.length - 1]?.startedAt.toISOString() ?? null
      },
      executionImpact: {
        attentionLevel: executionImpactAttentionLevel,
        lastSuccessfulCompletionAt,
        minutesSinceLastSuccessfulCompletion: lastSuccessfulCompletionDate
          ? minutesBetween(lastSuccessfulCompletionDate, now)
          : null,
        qualityEventsSinceLastSuccessfulCompletion,
        fallbackResolvesSinceLastSuccessfulCompletion,
        degradationStartsSinceLastSuccessfulCompletion,
        activeDegradedNetworks: activeDegradedNetworkKeys.size,
        queuedOrRunningJobsOnActiveDegradedNetworks,
        deadLetterJobsOnActiveDegradedNetworks
      },
      providerPressure: mapPressureGroups("provider", providerPressureGroups),
      asnPressure: mapPressureGroups("asn", asnPressureGroups),
      recoveryByFailureDomain
    },
    routeReprobeExecution,
    endpoints,
    networks,
    recentEvents
  };
}

// --------------------------------------------------------------------------
// AdminStore
// --------------------------------------------------------------------------

export function createAdminStore(prisma: PrismaClient) {
  return {
    async listAdminUsers(): Promise<AdminUserSummary[]> {
      return loadAdminUsers(prisma);
    },

    async updateAdmin(input: {
      userId: string;
      login?: string;
      displayName?: string;
      contact?: string;
      isAdmin?: boolean;
      opsAlertImmediateEnabled?: boolean;
      opsAlertDigestEnabled?: boolean;
      opsAlertEscalationTier?: "primary" | "secondary";
      status?: string;
      password?: string;
    }): Promise<AdminUserSummary> {
      const user = await prisma.user.findUnique({
        where: { id: input.userId },
        include: {
          passwordCredential: true
        }
      });

      if (!user) {
        throw new StoreAuthError("User not found", 404);
      }

      const updateData: Record<string, unknown> = {};

      if (input.displayName !== undefined) {
        updateData.displayName = input.displayName;
      }

      if (input.contact !== undefined) {
        updateData.contact = input.contact;
      }

      if (input.isAdmin !== undefined) {
        updateData.isAdmin = input.isAdmin;
      }

      if (input.opsAlertImmediateEnabled !== undefined) {
        updateData.opsAlertImmediateEnabled = input.opsAlertImmediateEnabled;
      }

      if (input.opsAlertDigestEnabled !== undefined) {
        updateData.opsAlertDigestEnabled = input.opsAlertDigestEnabled;
      }

      if (input.opsAlertEscalationTier !== undefined) {
        updateData.opsAlertEscalationTier = input.opsAlertEscalationTier;
      }

      if (input.status !== undefined) {
        updateData.status =
          input.status === "active"
            ? UserStatus.active
            : input.status === "blocked"
              ? UserStatus.blocked
              : UserStatus.trial;
      }

      if (Object.keys(updateData).length > 0) {
        await prisma.user.update({
          where: { id: input.userId },
          data: updateData
        });
      }

      if (input.password !== undefined) {
        const passwordHash = await hashPassword(input.password);

        if (user.passwordCredential) {
          await prisma.passwordCredential.update({
            where: { id: user.passwordCredential.id },
            data: { passwordHash }
          });
        } else {
          await prisma.passwordCredential.create({
            data: {
              id: `${input.userId}-password`,
              userId: input.userId,
              login: input.login ?? user.contact,
              passwordHash
            }
          });
        }
      }

      if (input.login !== undefined) {
        if (user.passwordCredential) {
          await prisma.passwordCredential.update({
            where: { id: user.passwordCredential.id },
            data: { login: input.login }
          });
        }
      }

      const updatedUser = await prisma.user.findUnique({
        where: { id: input.userId },
        include: {
          passwordCredential: true,
          authSessions: {
            orderBy: {
              lastAuthenticatedAt: "desc"
            },
            take: 1
          }
        }
      });

      if (!updatedUser) {
        throw new StoreAuthError("Updated user not found", 500);
      }

      return mapUserRowToAdminUserSummary(updatedUser);
    },

    async getRouteDecisionOpsSummary(input: {
      windowHours?: number;
      recentLimit?: number;
      summaryLimit?: number;
    }): Promise<RouteDecisionOpsSummary> {
      const windowHours = Number.isFinite(input.windowHours) ? Math.max(1, Math.trunc(input.windowHours as number)) : 72;
      const recentLimit = Number.isFinite(input.recentLimit) ? Math.min(Math.max(Math.trunc(input.recentLimit as number), 1), 50) : 12;
      const summaryLimit = Number.isFinite(input.summaryLimit) ? Math.min(Math.max(Math.trunc(input.summaryLimit as number), 1), 20) : 6;
      const sinceDate = new Date(Date.now() - windowHours * 60 * 60 * 1000);

      const routeEvents = await prisma.routeEvent.findMany({
        where: {
          occurredAt: {
            gte: sinceDate
          }
        },
        orderBy: {
          occurredAt: "asc"
        },
        include: {
          endpoint: {
            select: {
              id: true,
              label: true,
              provider: true,
              asn: true,
              transportProfile: true,
              city: true,
              countryCode: true,
              serverPool: {
                select: {
                  region: true
                }
              }
            }
          },
          networkFingerprint: {
            select: {
              id: true,
              networkType: true,
              carrier: true,
              asn: true,
              countryCode: true,
              region: true
            }
          }
        }
      });
      const routeReprobeJobs = await prisma.routeReprobeJob.findMany({
        where: {
          createdAt: {
            gte: sinceDate
          }
        },
        orderBy: {
          createdAt: "asc"
        }
      });
      const endpointInventory = await prisma.endpoint.findMany({
        where: {
          isActive: true,
          serverPool: {
            isActive: true
          }
        },
        select: {
          id: true,
          provider: true,
          asn: true,
          countryCode: true,
          serverPool: {
            select: {
              code: true,
              region: true
            }
          }
        }
      });
      return buildRouteDecisionOpsSummary({
        routeEvents,
        routeReprobeJobs,
        endpointInventory: endpointInventory.map((endpoint) => ({
          endpointId: endpoint.id,
          provider: endpoint.provider,
          asn: endpoint.asn,
          poolCode: endpoint.serverPool.code,
          countryCode: endpoint.countryCode,
          region: endpoint.serverPool.region
        })),
        windowHours,
        recentLimit,
        summaryLimit
      });
    },

    async getOpsSummary(input: {
      includeProbeStats?: boolean;
      timeWindowMinutes?: number;
    }): Promise<Record<string, unknown>> {
      const fallback = cloneDefaultState();
      const timeWindowMinutes = input.timeWindowMinutes ?? 60;
      const sinceDate = new Date(Date.now() - timeWindowMinutes * 60 * 1000);

      const totalUsers = await prisma.user.count();
      const activeUsers = await prisma.user.count({
        where: { status: UserStatus.active }
      });
      const blockedUsers = await prisma.user.count({
        where: { status: UserStatus.blocked }
      });
      const activeSubscriptions = await prisma.subscription.count({
        where: { status: SubscriptionStatus.active }
      });
      const currentSession = await prisma.appSession.findUnique({
        where: { id: "primary" }
      });

      const summary: Record<string, unknown> = {
        users: {
          total: totalUsers,
          active: activeUsers,
          blocked: blockedUsers
        },
        subscriptions: {
          active: activeSubscriptions
        },
        session: currentSession
          ? {
              status: currentSession.status,
              activeServerId: currentSession.activeServerId,
              updatedAt: currentSession.updatedAt.toISOString(),
              connectCount: currentSession.connectCount
            }
          : fallback,
        timeWindowMinutes,
        computedAt: new Date().toISOString()
      };

      if (input.includeProbeStats) {
        const totalProbes = await prisma.probeReport.count({
          where: {
            testedAt: {
              gte: sinceDate
            }
          }
        });
        const connectedProbes = await prisma.probeReport.count({
          where: {
            result: "connected",
            testedAt: {
              gte: sinceDate
            }
          }
        });
        const failedProbes = await prisma.probeReport.count({
          where: {
            result: "failed",
            testedAt: {
              gte: sinceDate
            }
          }
        });

        summary.probeStats = {
          total: totalProbes,
          connected: connectedProbes,
          failed: failedProbes,
          successRate: totalProbes > 0 ? Number(((connectedProbes / totalProbes) * 100).toFixed(1)) : 0
        };
      }

      return summary;
    }
  };
}
