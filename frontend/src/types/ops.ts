import type { TelemetryFailureReason } from "./route";

export type RouteDecisionOpsTotals = {
  feedbackEvents: number;
  connectedCount: number;
  unstableCount: number;
  failedCount: number;
  successRate: number;
  uniqueEndpoints: number;
  uniqueNetworks: number;
};

export type RouteDecisionOpsFallbackPressure = {
  observationCount: number;
  fallbackCount: number;
  fallbackRate: number;
  dominantFallbackReason: string | null;
  lastTriggeredAt: string | null;
};

export type RouteDecisionOpsDegradationWindows = {
  total: number;
  active: number;
  resolved: number;
  affectedEndpoints: number;
  affectedNetworks: number;
  longestActiveMinutes: number | null;
  lastStartedAt: string | null;
};

export type RouteDecisionOpsRecoveryTime = {
  resolvedWindowCount: number;
  averageMinutes: number | null;
  medianMinutes: number | null;
  lastRecoveredAt: string | null;
};

export type RouteDecisionOpsSlaWindows = {
  windowSizeMinutes: number;
  availabilityTarget: number;
  total: number;
  healthy: number;
  breached: number;
  breachRate: number;
  currentHealthyStreak: number;
  lastBreachAt: string | null;
};

export type RouteDecisionOpsFailureDomainPressure = {
  domainType: "provider" | "asn";
  domainKey: string;
  label: string;
  observationCount: number;
  fallbackCount: number;
  fallbackRate: number;
  affectedEndpoints: number;
  lastTriggeredAt: string | null;
};

export type RouteDecisionOpsFailureDomainRecovery = {
  domainType: "provider" | "asn";
  domainKey: string;
  label: string;
  activeWindows: number;
  resolvedWindows: number;
  averageRecoveryMinutes: number | null;
  medianRecoveryMinutes: number | null;
  lastRecoveredAt: string | null;
};

export type RouteDecisionExecutionImpact = {
  attentionLevel: "stable" | "watch" | "critical";
  lastSuccessfulCompletionAt: string | null;
  minutesSinceLastSuccessfulCompletion: number | null;
  qualityEventsSinceLastSuccessfulCompletion: number;
  fallbackResolvesSinceLastSuccessfulCompletion: number;
  degradationStartsSinceLastSuccessfulCompletion: number;
  activeDegradedNetworks: number;
  queuedOrRunningJobsOnActiveDegradedNetworks: number;
  deadLetterJobsOnActiveDegradedNetworks: number;
};

export type RouteDecisionOpsAlert = {
  id: string;
  severity: "watch" | "critical";
  title: string;
  detail: string;
};

export type OpsAlertSeverity = "watch" | "critical";
export type OpsAlertStatus = "active" | "acknowledged" | "snoozed" | "resolved";

export type OpsAlertSummary = {
  id: string;
  alertType: string;
  severity: OpsAlertSeverity;
  status: OpsAlertStatus;
  dedupeKey: string;
  title: string;
  detail: string;
  metadata: Record<string, unknown>;
  startedAt: string;
  lastDetectedAt: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  snoozedUntil: string | null;
  createdAt: string;
  updatedAt: string;
};

export type OpsAlertEscalationChannel = "telegram" | "email";
export type OpsAlertEscalationLevel = "none" | "digest" | "immediate";
export type OpsAlertDeliveryStatus = "delivered" | "failed";

export type OpsAlertEscalationRecipient = {
  userId: string;
  displayName: string;
  contact: string;
  channel: OpsAlertEscalationChannel;
  escalationTier: "primary" | "secondary";
  chainStep: number;
  reason: string;
};

export type OpsAlertEscalationPreview = {
  alertId: string;
  alertStatus: OpsAlertStatus;
  alertSeverity: OpsAlertSeverity;
  escalationLevel: OpsAlertEscalationLevel;
  shouldEscalate: boolean;
  reason: string;
  recipients: OpsAlertEscalationRecipient[];
  recommendedSubject: string;
  recommendedMessage: string;
  generatedAt: string;
};

export type OpsAlertDeliverySummary = {
  id: string;
  alertId: string;
  batchId: string;
  channel: OpsAlertEscalationChannel;
  escalationLevel: OpsAlertEscalationLevel;
  status: OpsAlertDeliveryStatus;
  recipientUserId: string | null;
  recipientDisplayName: string;
  recipientContact: string;
  subject: string;
  message: string;
  reason: string;
  deliveryPath: string;
  providerMessageId: string | null;
  actorUserId: string | null;
  deliveredAt: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type RouteDecisionOpsRetentionPolicy = {
  probeReportsDays: number;
  routeEventsDays: number;
  routeReprobeJobsDays: number;
  routeSuccessRollupsDays: number;
  routeRankingsDays: number;
};

export type RouteDecisionOpsHistoryWindow = {
  startedAt: string;
  endedAt: string;
  severity: "ok" | "watch" | "critical";
  feedbackEvents: number;
  connectedCount: number;
  unstableCount: number;
  failedCount: number;
  fallbackResolves: number;
  queuedJobs: number;
  completedJobs: number;
  deadLetterJobs: number;
};

export type RouteDecisionOpsDailyHistoryWindow = {
  startedAt: string;
  endedAt: string;
  severity: "ok" | "watch" | "critical";
  hourlyWindows: number;
  feedbackEvents: number;
  connectedCount: number;
  unstableCount: number;
  failedCount: number;
  fallbackResolves: number;
  queuedJobs: number;
  completedJobs: number;
  deadLetterJobs: number;
};

export type RouteDecisionOpsInventoryHealth = {
  riskLevel: "ok" | "watch" | "critical";
  activeEndpoints: number;
  distinctProviders: number;
  distinctAsns: number;
  distinctPools: number;
  distinctRegions: number;
  largestRegionalDomainSize: number;
  minimumRecommendedFailureDomains: number;
  failedDimensions: string[];
  policyViolationMessage: string | null;
};

export type RouteDecisionOpsOperationalSummary = {
  overallSeverity: "ok" | "watch" | "critical";
  activeAlertCount: number;
  alerts: RouteDecisionOpsAlert[];
  inventoryHealth: RouteDecisionOpsInventoryHealth;
  clientSync: RouteDecisionOpsClientSyncHealth;
  retention: RouteDecisionOpsRetentionPolicy;
  history: RouteDecisionOpsHistoryWindow[];
  dailyHistory: RouteDecisionOpsDailyHistoryWindow[];
};

// Зеркало backend/src/types.ts — здоровье per-node client-list синка
// (deploy/xray/sync-clients.sh): stalePools — активные пулы, чей хартбит
// старше порога или отсутствует.
export type RouteDecisionOpsClientSyncHealth = {
  trackedPools: number;
  stalePools: string[];
  thresholdMinutes: number;
};

export type RouteDecisionQualityMetrics = {
  fallbackPressure: RouteDecisionOpsFallbackPressure;
  degradationWindows: RouteDecisionOpsDegradationWindows;
  recoveryTime: RouteDecisionOpsRecoveryTime;
  slaWindows: RouteDecisionOpsSlaWindows;
  executionImpact: RouteDecisionExecutionImpact;
  providerPressure: RouteDecisionOpsFailureDomainPressure[];
  asnPressure: RouteDecisionOpsFailureDomainPressure[];
  recoveryByFailureDomain: RouteDecisionOpsFailureDomainRecovery[];
};

export type RouteDecisionOpsEndpointSummary = {
  endpointId: string;
  label: string;
  region: string;
  provider: string;
  transportProfile: string;
  feedbackEvents: number;
  connectedCount: number;
  unstableCount: number;
  failedCount: number;
  successRate: number;
  lastEventAt: string;
  dominantFailureReason: TelemetryFailureReason | null;
};

export type RouteDecisionOpsNetworkSummary = {
  networkFingerprintId: string | null;
  networkType: string | null;
  carrier: string | null;
  asn: number | null;
  countryCode: string | null;
  region: string | null;
  feedbackEvents: number;
  connectedCount: number;
  unstableCount: number;
  failedCount: number;
  successRate: number;
  lastEventAt: string;
};

export type RouteDecisionOpsEventSummary = {
  id: string;
  occurredAt: string;
  endpointId: string | null;
  endpointLabel: string | null;
  endpointRegion: string | null;
  provider: string | null;
  transportProfile: string;
  feedbackResult: "connected" | "unstable" | "failed" | null;
  failureReason: TelemetryFailureReason | null;
  networkFingerprintId: string | null;
  networkType: string | null;
  carrier: string | null;
  asn: number | null;
  countryCode: string | null;
  region: string | null;
  source: "resolve" | "connect" | "runtime_reprobe" | "manual_report" | null;
  latencyMs: number | null;
  appVersion: string | null;
  note: string | null;
};

export type RouteReprobeExecutionTotals = {
  totalJobs: number;
  queuedJobs: number;
  runningJobs: number;
  completedJobs: number;
  deadLetterJobs: number;
  retryScheduledCount: number;
  leaseReclaimedCount: number;
  overdueQueuedJobs: number;
  staleRunningJobs: number;
  completionRate: number;
  deadLetterRate: number;
  retryRate: number;
};

export type RouteReprobeExecutionTiming = {
  averageTimeToStartMinutes: number | null;
  medianTimeToStartMinutes: number | null;
  p95TimeToStartMinutes: number | null;
  averageLifecycleMinutes: number | null;
  medianLifecycleMinutes: number | null;
  p95LifecycleMinutes: number | null;
  oldestQueuedAgeMinutes: number | null;
  longestRunningAgeMinutes: number | null;
};

export type RouteReprobeWorkerHealth = {
  activeWorkerCount: number;
  latestWorkerActivityAt: string | null;
  lastClaimedAt: string | null;
  lastCompletedAt: string | null;
};

export type RouteReprobeJobAttemptAuditEntry = {
  attempt: number;
  event:
    | "queued"
    | "claimed"
    | "lease_reclaimed"
    | "retry_scheduled"
    | "completed"
    | "failed"
    | "dead_lettered";
  at: string;
  workerId: string | null;
  message: string | null;
  nextAttemptAt: string | null;
};

export type RouteReprobeCandidateSummary = {
  endpointId: string;
  transportProfile: string;
  assignmentReason: string;
  provider: string;
  region: string;
  healthStatus: "healthy" | "penalized" | "avoid" | "unknown";
  penaltyScore: number | null;
  dominantFailureReason: TelemetryFailureReason | null;
};

export type RouteReprobeJobOpsSummary = {
  id: string;
  status: "queued" | "running" | "completed" | "failed" | "dead_letter";
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  context: {
    networkType?: string;
    carrier?: string;
    asn?: number;
    countryCode?: string;
    region?: string;
  };
  note: string | null;
  candidateLimit: number;
  recommendedEndpointId: string | null;
  candidates: RouteReprobeCandidateSummary[];
  recordedResultsCount: number;
  failureMessage: string | null;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: string | null;
  leaseExpiresAt: string | null;
  leaseReclaimedCount: number;
  deadLetteredAt: string | null;
  attemptAudit: RouteReprobeJobAttemptAuditEntry[];
  timeToStartMinutes: number | null;
  lifecycleMinutes: number | null;
  latestAttemptAt: string | null;
  latestAttemptEvent: RouteReprobeJobAttemptAuditEntry["event"] | null;
  qualityImpact: {
    feedbackEventsOnJobNetwork: number;
    connectedCountOnJobNetwork: number;
    unstableCountOnJobNetwork: number;
    failedCountOnJobNetwork: number;
    fallbackResolvesOnJobNetwork: number;
    degradationStartsOnJobNetwork: number;
    activeDegradationOnJobNetwork: boolean;
    dominantFailureReasonOnJobNetwork: TelemetryFailureReason | null;
    latestQualityEventAt: string | null;
  };
};

export type RouteReprobeExecutionTimelineEntry = {
  at: string;
  jobId: string;
  jobStatus: "queued" | "running" | "completed" | "failed" | "dead_letter";
  attempt: number;
  event: RouteReprobeJobAttemptAuditEntry["event"];
  workerId: string | null;
  message: string | null;
  network: {
    networkType?: string;
    carrier?: string;
    asn?: number;
    countryCode?: string;
    region?: string;
  };
};

export type RouteReprobeExecutionFailureDrilldown = {
  failureKey: string;
  latestAt: string;
  affectedJobs: number;
  deadLetterJobs: number;
  retryScheduledCount: number;
  failedEventCount: number;
  leaseReclaimedCount: number;
  sampleJobIds: string[];
};

export type RouteReprobeExecutionNetworkHotspot = {
  networkKey: string;
  network: {
    networkType?: string;
    carrier?: string;
    asn?: number;
    countryCode?: string;
    region?: string;
  };
  totalJobs: number;
  queuedJobs: number;
  runningJobs: number;
  completedJobs: number;
  deadLetterJobs: number;
  activeDegradation: boolean;
  activeDegradationMinutes: number | null;
  feedbackEvents: number;
  connectedCount: number;
  unstableCount: number;
  failedCount: number;
  fallbackResolves: number;
  latestJobAt: string | null;
  latestQualityEventAt: string | null;
  dominantFailureReason: TelemetryFailureReason | null;
  sampleJobIds: string[];
};

export type RouteReprobeExecutionWorkerAlert = {
  id: string;
  severity: "watch" | "critical";
  workerId: string;
  title: string;
  detail: string;
  latestActivityAt: string | null;
};

export type RouteReprobeExecutionWorkerHotspot = {
  workerId: string;
  activeJobs: number;
  claimedJobs: number;
  completedJobs: number;
  deadLetterJobs: number;
  retryScheduledCount: number;
  failedEventCount: number;
  leaseReclaimedCount: number;
  staleRunningJobs: number;
  latestActivityAt: string | null;
  lastClaimedAt: string | null;
  lastCompletedAt: string | null;
  sampleJobIds: string[];
  failureKeys: string[];
};

export type RouteReprobeExecutionSummary = {
  totals: RouteReprobeExecutionTotals;
  timing: RouteReprobeExecutionTiming;
  workerHealth: RouteReprobeWorkerHealth;
  recentJobs: RouteReprobeJobOpsSummary[];
  timeline: RouteReprobeExecutionTimelineEntry[];
  failureDrilldown: RouteReprobeExecutionFailureDrilldown[];
  networkHotspots: RouteReprobeExecutionNetworkHotspot[];
  workerAlerts: RouteReprobeExecutionWorkerAlert[];
  workerHotspots: RouteReprobeExecutionWorkerHotspot[];
  focusedDrilldowns: {
    worker: {
      workerId: string;
      latestActivityAt: string | null;
      activeAlertCount: number;
      activeJobs: number;
      deadLetterJobs: number;
      staleRunningJobs: number;
      retryScheduledCount: number;
      failedEventCount: number;
      leaseReclaimedCount: number;
      sampleJobIds: string[];
      recentTimeline: RouteReprobeExecutionTimelineEntry[];
      relatedFailures: RouteReprobeExecutionFailureDrilldown[];
    } | null;
    network: {
      networkKey: string;
      network: {
        networkType?: string;
        carrier?: string;
        asn?: number;
        countryCode?: string;
        region?: string;
      };
      queuedOrRunningJobs: number;
      deadLetterJobs: number;
      activeDegradation: boolean;
      activeDegradationMinutes: number | null;
      feedbackEvents: number;
      connectedCount: number;
      unstableCount: number;
      failedCount: number;
      fallbackResolves: number;
      dominantFailureReason: TelemetryFailureReason | null;
      latestJobAt: string | null;
      latestQualityEventAt: string | null;
      sampleJobIds: string[];
      recentTimeline: RouteReprobeExecutionTimelineEntry[];
      relatedJobs: RouteReprobeJobOpsSummary[];
    } | null;
    job: {
      job: RouteReprobeJobOpsSummary;
      relatedWorkerIds: string[];
      attemptTrail: RouteReprobeExecutionTimelineEntry[];
      relatedFailures: RouteReprobeExecutionFailureDrilldown[];
    } | null;
  };
};

export type RouteDecisionOpsSummary = {
  generatedAt: string;
  windowHours: number;
  totals: RouteDecisionOpsTotals;
  operationalSummary: RouteDecisionOpsOperationalSummary;
  qualityMetrics: RouteDecisionQualityMetrics;
  routeReprobeExecution: RouteReprobeExecutionSummary;
  endpoints: RouteDecisionOpsEndpointSummary[];
  networks: RouteDecisionOpsNetworkSummary[];
  recentEvents: RouteDecisionOpsEventSummary[];
};

export type RouteDecisionOpsResponse = {
  ops: RouteDecisionOpsSummary;
};

export type OpsAlertsResponse = {
  alerts: OpsAlertSummary[];
};

export type UpdateOpsAlertResponse = {
  alert: OpsAlertSummary;
};

export type OpsAlertEscalationPreviewResponse = {
  preview: OpsAlertEscalationPreview;
};

export type OpsAlertDeliveriesResponse = {
  deliveries: OpsAlertDeliverySummary[];
};

export type DeliverOpsAlertResponse = {
  alert: OpsAlertSummary;
  preview: OpsAlertEscalationPreview;
  deliveries: OpsAlertDeliverySummary[];
};

export type DeliverOpsAlertDigestResponse = {
  alerts: OpsAlertSummary[];
  deliveries: OpsAlertDeliverySummary[];
  batchId: string;
  subject: string;
};
