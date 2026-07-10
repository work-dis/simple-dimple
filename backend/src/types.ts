export type ConnectionStatus = "disconnected" | "connecting" | "connected";
export type ContactType = "telegram" | "email";
export type UserStatus = "active" | "blocked" | "trial";
export type AuthProvider = "credentials" | "telegram" | "email";
export type AuthSessionStatus = "active" | "revoked" | "expired";
export type VerificationChallengeProvider = "telegram" | "email";
export type OpsAlertEscalationTier = "primary" | "secondary";

export type ServerOption = {
  id: string;
  label: string;
  region: string;
  countryCode: string;
  provider: string;
  asn: number | null;
  ipAddress: string | null;
  poolCode: string;
  protocol: string;
  transportProfile: string;
  latencyMs: number;
  loadPercent: number;
};

export type RoutePolicyCandidate = {
  endpointId: string;
  assignmentReason: string;
  label: string;
  region: string;
  provider: string;
  asn: number | null;
  ipAddress: string | null;
  poolCode: string;
  protocol: string;
  transportProfile: string;
  latencyMs: number;
  loadPercent: number;
};

export type RoutePolicyTrace = {
  selectedBy: "manual_override" | "last_known_good" | "network_ranking" | "baseline_pool_priority" | "none";
  usedManualOverride: boolean;
  usedLastKnownGood: boolean;
  usedNetworkRanking: boolean;
  usedHealthAwarePrimarySelection: boolean;
  usedRouteHealthPenalties: boolean;
  usedHealthAwareShortlist: boolean;
  usedDegradedAvoidance: boolean;
  routeHealthAvoidedCount: number;
  routeHealthPenalizedCount: number;
  degradedEndpointCount: number;
  fallbackTier: "manual" | "last_known_good" | "ranking" | "baseline" | "none";
  diversityStageReached: "strict" | "partial" | "same_domain_only" | "none";
  shortlistDistinctProviders: number;
  shortlistDistinctAsns: number;
  shortlistPenalizedCount: number;
  topPenaltyReason: TelemetryFailureReason | null;
  topPenaltyConfidence: number | null;
  recommendedEndpointHealth: RouteHealthStatus | "unknown";
  recommendedEndpointPenaltyScore: number | null;
  recommendedEndpointFailureReason: TelemetryFailureReason | null;
  primaryCandidateEndpointId: string | null;
  primaryCandidateHealth: RouteHealthStatus | "unknown";
  primaryCandidatePenaltyScore: number | null;
  healthAdjustedPrimaryEndpointId: string | null;
};

export type RoutePolicySummary = {
  recommendedEndpointId: string | null;
  recommendedReason: string | null;
  shortlist: RoutePolicyCandidate[];
  trace: RoutePolicyTrace;
};

export type RouteHealthStatus = "healthy" | "penalized" | "avoid";

export type RouteHealthSnapshotSummary = {
  endpointId: string;
  penaltyScore: number;
  confidence: number;
  freshFailureCount: number;
  dominantFailureReason: TelemetryFailureReason | null;
  lastFailureAt: string | null;
  status: RouteHealthStatus;
};

export type SessionState = {
  status: ConnectionStatus;
  activeServerId: string;
  updatedAt: string;
  connectCount: number;
};

export type EndpointAssignmentSummary = {
  id: string;
  endpointId: string;
  deviceId: string | null;
  assignmentReason: string;
  assignedAt: string;
  expiresAt: string | null;
};

export type ConnectionConfigSummary = {
  endpointId: string;
  protocol: "vless";
  security: "reality";
  uri: string;
  params: {
    uuid: string;
    address: string;
    port: number;
    flow: string;
    sni: string;
    fingerprint: string;
    publicKey: string;
    shortId: string;
  };
};

export type LastKnownGoodRouteSummary = {
  id: string;
  endpointId: string;
  deviceId: string | null;
  networkFingerprintId: string | null;
  sourceAssignmentReason: string | null;
  lastSucceededAt: string;
  expiresAt: string | null;
};

export type UserProfile = {
  id: string;
  login: string;
  displayName: string;
  contact: string;
  contactType: ContactType;
  isAdmin: boolean;
  status: UserStatus;
  memberSince: string;
};

export type SubscriptionSummary = {
  plan: string;
  renewalDate: string;
  status: "active" | "grace";
  autoRenew: boolean;
};

export type DeviceSummary = {
  id: string;
  name: string;
  platform: string;
  lastSeenAt: string;
  isCurrent: boolean;
};

export type AccountSummary = {
  user: UserProfile;
  subscription: SubscriptionSummary;
  devices: DeviceSummary[];
};

export type AdminUserSummary = {
  id: string;
  login: string;
  displayName: string;
  contact: string;
  contactType: ContactType;
  isAdmin: boolean;
  opsAlertImmediateEnabled: boolean;
  opsAlertDigestEnabled: boolean;
  opsAlertEscalationTier: OpsAlertEscalationTier;
  status: UserStatus;
  memberSince: string;
  lastAuthenticatedAt: string | null;
};

export type AuthSessionSummary = {
  id: string;
  userId: string | null;
  provider: AuthProvider;
  status: AuthSessionStatus;
  isAuthenticated: boolean;
  lastAuthenticatedAt: string | null;
  expiresAt: string | null;
};

export type UpdateAccountProfileBody = {
  displayName?: string;
  contact?: string;
};

export type UpdateUserAdminBody = {
  isAdmin?: boolean;
  opsAlertImmediateEnabled?: boolean;
  opsAlertDigestEnabled?: boolean;
  opsAlertEscalationTier?: OpsAlertEscalationTier;
};

// Шаг 5 (PRIORITY_PLAN.md) — fleet provisioning для Xray-нод. Отдельно от
// AdminUserSummary/UpdateUserAdminBody выше (те про users, эти — про
// endpoint-инвентарь).
export type AdminEndpointTransportSummary = {
  port: number;
  sni: string;
  fingerprint: string;
  flow: string;
  shortId: string;
};

export type AdminEndpointSummary = {
  id: string;
  label: string;
  provider: string;
  asn: number | null;
  countryCode: string;
  city: string | null;
  poolCode: string;
  region: string | null;
  ipAddress: string;
  protocol: string;
  transportProfile: string;
  latencyMs: number;
  loadPercent: number;
  isActive: boolean;
  lastHealthCheckAt: string | null;
  lastHealthCheckOk: boolean | null;
  consecutiveHealthFailures: number;
  retiredAt: string | null;
  retiredReason: string | null;
  transport: AdminEndpointTransportSummary | null;
  createdAt: string;
};

export type RegisterAdminEndpointBody = {
  label?: string;
  ipAddress?: string;
  provider?: string;
  asn?: number;
  countryCode?: string;
  city?: string;
  poolCode?: string;
  region?: string;
  priority?: number;
  protocol?: string;
  transportProfile?: string;
  latencyMs?: number;
  loadPercent?: number;
  port?: number;
  publicKey?: string;
  shortId?: string;
  sni?: string;
  fingerprint?: string;
  flow?: string;
};

export type SetAdminEndpointActiveBody = {
  isActive?: boolean;
  // Только для isActive:false — свободный текст для аудита ("provider
  // decommissioned the box", "swapping for a Hetzner node" и т.п.).
  // Дефолт "manual", если не передан. Игнорируется при isActive:true —
  // реактивация всегда чистит retiredAt/retiredReason.
  retiredReason?: string;
};

// Шаг 2 (PRIORITY_PLAN.md) — источник правды для per-node client-list sync
// (deploy/xray/sync-clients.sh): каждая Xray-нода периодически подтягивает
// этот список и перекладывает его в inbound.settings.clients, вместо того
// чтобы держать один захардкоженный client id на весь провижининг.
export type VlessClientSummary = {
  uuid: string;
  flow: string;
};

export type LoginWithPasswordBody = {
  login?: string;
  password?: string;
};

export type RegisterWithPasswordBody = {
  login?: string;
  password?: string;
  displayName?: string;
};

export type RequestAuthChallengeBody = {
  provider?: VerificationChallengeProvider;
  target?: string;
};

export type VerifyAuthChallengeBody = {
  challengeId?: string;
  code?: string;
  displayName?: string;
};

export type NetworkType = "wifi" | "mobile" | "unknown";
export type TelemetryProbeResult = "connected" | "unstable" | "failed";
export type TelemetryFailureReason =
  | "timeout"
  | "handshake_failed"
  | "connect_refused"
  | "dns_blocked"
  | "captive_portal"
  | "packet_loss_suspected"
  | "tls_error"
  | "unknown";

export type TelemetryNetworkContext = {
  networkType?: NetworkType;
  carrier?: string;
  asn?: number;
  countryCode?: string;
  region?: string;
};

export type ResolveRoutesBody = TelemetryNetworkContext & {
  manualEndpointId?: string;
  includeServers?: boolean;
};

// Шаг 6 (PRIORITY_PLAN.md) / Decision 024 — bridge-модель: вместо полного
// inventory клиент получает подмножество (см.
// backend/src/inventory-segmentation.ts). pinnedEndpointIds не дают continuity
// сломаться — уже активное подключение, последний известный рабочий маршрут и
// явно запрошенный manualEndpointId всегда остаются видимыми, даже если их
// hash-ранг для этого пользователя/периода их бы не выбрал.
export type ServerSegmentationContext = {
  subjectId: string;
  pinnedEndpointIds?: readonly string[];
};

export type RouteFeedbackResult = "connected" | "unstable" | "failed";
export type RouteFeedbackSource = "resolve" | "connect" | "runtime_reprobe" | "manual_report";

export type RouteFeedbackBody = TelemetryNetworkContext & {
  endpointId?: string;
  transportProfile?: string;
  result?: RouteFeedbackResult;
  failureReason?: TelemetryFailureReason;
  occurredAt?: string;
  latencyMs?: number;
  appVersion?: string;
  source?: RouteFeedbackSource;
  note?: string;
};

export type RecordRouteFeedbackInput = TelemetryNetworkContext & {
  endpointId: string;
  transportProfile: string;
  result: RouteFeedbackResult;
  failureReason?: TelemetryFailureReason;
  occurredAt: string;
  latencyMs?: number;
  appVersion?: string;
  source: RouteFeedbackSource;
  note?: string;
};

export type RouteReprobeResultBody = {
  endpointId?: string;
  transportProfile?: string;
  result?: RouteFeedbackResult;
  failureReason?: TelemetryFailureReason;
  latencyMs?: number;
  occurredAt?: string;
};

export type RouteReprobeJobBody = TelemetryNetworkContext & {
  candidateLimit?: number;
  maxAttempts?: number;
  note?: string;
  appVersion?: string;
  results?: RouteReprobeResultBody[];
};

export type RouteReprobeCandidateSummary = {
  endpointId: string;
  transportProfile: string;
  assignmentReason: string;
  provider: string;
  region: string;
  healthStatus: RouteHealthStatus | "unknown";
  penaltyScore: number | null;
  dominantFailureReason: TelemetryFailureReason | null;
};

export type RouteReprobeJobStatus = "queued" | "running" | "completed" | "failed" | "dead_letter";

export type RouteReprobeJobAttemptAuditEntry = {
  attempt: number;
  event: "queued" | "claimed" | "lease_reclaimed" | "retry_scheduled" | "completed" | "failed" | "dead_lettered";
  at: string;
  workerId: string | null;
  message: string | null;
  nextAttemptAt: string | null;
};

export type RouteReprobeJobSummary = {
  id: string;
  status: RouteReprobeJobStatus;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  context: TelemetryNetworkContext;
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
};

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
  escalationTier: OpsAlertEscalationTier;
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

export type OpsAlertListOptions = {
  includeResolved?: boolean;
  limit?: number;
  refresh?: boolean;
  windowHours?: number;
  recentLimit?: number;
  summaryLimit?: number;
};

export type SnoozeOpsAlertBody = {
  minutes?: number;
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
  retention: RouteDecisionOpsRetentionPolicy;
  history: RouteDecisionOpsHistoryWindow[];
  dailyHistory: RouteDecisionOpsDailyHistoryWindow[];
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
  feedbackResult: RouteFeedbackResult | null;
  failureReason: TelemetryFailureReason | null;
  networkFingerprintId: string | null;
  networkType: string | null;
  carrier: string | null;
  asn: number | null;
  countryCode: string | null;
  region: string | null;
  source: RouteFeedbackSource | null;
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

export type RouteReprobeJobOpsSummary = RouteReprobeJobSummary & {
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
  jobStatus: RouteReprobeJobStatus;
  attempt: number;
  event: RouteReprobeJobAttemptAuditEntry["event"];
  workerId: string | null;
  message: string | null;
  network: TelemetryNetworkContext;
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
  network: TelemetryNetworkContext;
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
      network: TelemetryNetworkContext;
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

export type AdminOpsSummary = {
  users: {
    total: number;
    active: number;
    blocked: number;
  };
  subscriptions: {
    active: number;
  };
  connections: {
    tracked: number;
    connected: number;
  };
  timeWindowMinutes: number;
  computedAt: string;
  probeStats?: {
    total: number;
    connected: number;
    failed: number;
    successRate: number;
  };
};

export type TelemetryProbeBody = TelemetryNetworkContext & {
  endpointId?: string;
  transportProfile?: string;
  result?: TelemetryProbeResult;
  failureReason?: TelemetryFailureReason;
  latencyMs?: number;
  bytesSent?: number;
  bytesReceived?: number;
  appVersion?: string;
  testedAt?: string;
};
