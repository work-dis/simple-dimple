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
import {
  StoreAuthError,
  hashPassword,
  cloneDefaultState,
  mapUserRowToAdminUserSummary
} from "./utils.js";
import { loadAdminUsers } from "./shared.js";
import { mapRouteReprobeJobSummary } from "./route-reprobe-jobs.js";

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
  provider: string | null;
  endpointAsn: number | null;
  startedAt: Date;
  resolvedAt?: Date;
};

function parseAuditTimestamp(entry: RouteReprobeJobAttemptAuditEntry) {
  const timestamp = Date.parse(entry.at);
  return Number.isNaN(timestamp) ? null : new Date(timestamp);
}

function buildRouteReprobeExecutionSummary(input: {
  jobs: RouteReprobeJob[];
  summaryLimit: number;
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

      return {
        ...job,
        timeToStartMinutes,
        lifecycleMinutes,
        latestAttemptAt: latestAttempt?.at ?? null,
        latestAttemptEvent: latestAttempt?.event ?? null
      };
    });

  for (const job of jobs) {
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
    recentJobs
  };
}

function floorToWindow(date: Date, windowSizeMinutes: number) {
  const windowMs = windowSizeMinutes * 60 * 1000;
  return new Date(Math.floor(date.getTime() / windowMs) * windowMs);
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
      providerPressure: mapPressureGroups("provider", providerPressureGroups),
      asnPressure: mapPressureGroups("asn", asnPressureGroups),
      recoveryByFailureDomain
    },
    routeReprobeExecution: buildRouteReprobeExecutionSummary({
      jobs: input.routeReprobeJobs,
      summaryLimit: input.summaryLimit,
      now
    }),
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
      return buildRouteDecisionOpsSummary({
        routeEvents,
        routeReprobeJobs,
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
