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

export type RouteDecisionQualityMetrics = {
  fallbackPressure: RouteDecisionOpsFallbackPressure;
  degradationWindows: RouteDecisionOpsDegradationWindows;
  recoveryTime: RouteDecisionOpsRecoveryTime;
  slaWindows: RouteDecisionOpsSlaWindows;
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
};

export type RouteReprobeExecutionSummary = {
  totals: RouteReprobeExecutionTotals;
  timing: RouteReprobeExecutionTiming;
  workerHealth: RouteReprobeWorkerHealth;
  recentJobs: RouteReprobeJobOpsSummary[];
};

export type RouteDecisionOpsSummary = {
  generatedAt: string;
  windowHours: number;
  totals: RouteDecisionOpsTotals;
  qualityMetrics: RouteDecisionQualityMetrics;
  routeReprobeExecution: RouteReprobeExecutionSummary;
  endpoints: RouteDecisionOpsEndpointSummary[];
  networks: RouteDecisionOpsNetworkSummary[];
  recentEvents: RouteDecisionOpsEventSummary[];
};

export type RouteDecisionOpsResponse = {
  ops: RouteDecisionOpsSummary;
};
