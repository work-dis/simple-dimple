import type { RouteReprobeJob } from "../generated/prisma/client.js";
import type {
  RouteReprobeExecutionSummary,
  RouteReprobeJobOpsSummary,
  TelemetryFailureReason
} from "../types.js";
import { mapRouteReprobeJobSummary } from "./route-reprobe-jobs.js";
import {
  asFailureReason,
  buildNetworkContextKey,
  compareIsoDesc,
  isFallbackRecommendation,
  median,
  minutesBetween,
  parseAuditTimestamp,
  parseJobContext,
  percentile,
  readMetadataValue,
  readNullableString
} from "./ops-summary-shared.js";
import type { DegradationWindow, RouteDecisionOpsEventRecord } from "./ops-summary-shared.js";

export function buildRouteReprobeExecutionSummary(input: {
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

