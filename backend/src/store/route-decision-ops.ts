import type { RouteReprobeJob } from "../generated/prisma/client.js";
import type {
  RouteDecisionOpsEndpointSummary,
  RouteDecisionOpsEventSummary,
  RouteDecisionOpsNetworkSummary,
  RouteDecisionOpsSummary,
  TelemetryFailureReason
} from "../types.js";
import { summarizeInventoryHealth } from "../inventory-policy.js";
import { computeOpsOverallSeverity, detectOpsAlerts } from "./ops-alert-detector.js";
import { buildRouteReprobeExecutionSummary } from "./route-reprobe-execution-summary.js";
import {
  addMinutes,
  asFailureReason,
  buildNetworkContextKey,
  floorToWindow,
  formatDomainLabel,
  isFallbackRecommendation,
  isRecord,
  median,
  minutesBetween,
  opsRetentionPolicy,
  readEventSource,
  readMetadataValue,
  readNullableNumber,
  readNullableString
} from "./ops-summary-shared.js";
import type { DegradationWindow, InventoryEndpointRecord, RouteDecisionOpsEventRecord } from "./ops-summary-shared.js";

// Порог протухания client-list синка. Крон на нодах ходит раз в 5 минут;
// 30 минут = 6 подряд пропущенных прогонов — заведомо не разовый флап сети.
export const clientSyncStaleThresholdMinutes = 30;

export type PoolClientSyncRecord = {
  code: string;
  clientsSyncedAt: Date | null;
};

export function buildRouteDecisionOpsSummary(input: {
  routeEvents: RouteDecisionOpsEventRecord[];
  routeReprobeJobs: RouteReprobeJob[];
  endpointInventory?: InventoryEndpointRecord[];
  poolClientSync?: PoolClientSyncRecord[];
  windowHours: number;
  recentLimit: number;
  summaryLimit: number;
  now?: Date;
}): RouteDecisionOpsSummary {
  const now = input.now ?? new Date();
  // Хартбит client-list синка: пул "протух", если активная нода не читала
  // /api/admin/vless-clients?pool=<code> дольше порога (крон на нодах ходит
  // раз в 5 минут — 30 минут это 6 подряд пропущенных прогонов, не флап).
  // clientsSyncedAt === null означает "ни разу с момента ввода хартбита" и
  // тоже считается протухшим — иначе сломанный с самого начала крон никогда
  // не поднимет алерт.
  const poolClientSyncRecords = input.poolClientSync ?? [];
  const staleClientSyncPools = poolClientSyncRecords
    .filter(
      (pool) =>
        pool.clientsSyncedAt === null ||
        now.getTime() - pool.clientsSyncedAt.getTime() > clientSyncStaleThresholdMinutes * 60_000
    )
    .map((pool) => pool.code)
    .sort();
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
      const { failureCounts: _failureCounts, ...summary } = endpoint;
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
    inventoryPolicyViolationMessage: inventoryHealth.policyViolationMessage,
    staleClientSyncPools,
    clientSyncThresholdMinutes: clientSyncStaleThresholdMinutes
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
      clientSync: {
        trackedPools: poolClientSyncRecords.length,
        stalePools: staleClientSyncPools,
        thresholdMinutes: clientSyncStaleThresholdMinutes
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
