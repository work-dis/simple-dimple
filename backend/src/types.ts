export type ConnectionStatus = "disconnected" | "connecting" | "connected";
export type ContactType = "telegram" | "email";
export type UserStatus = "active" | "blocked" | "trial";
export type AuthProvider = "credentials" | "telegram" | "email";
export type AuthSessionStatus = "active" | "revoked" | "expired";
export type VerificationChallengeProvider = "telegram" | "email";

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

export type PersistedState = {
  auth: AuthSessionSummary;
  session: SessionState;
  account: AccountSummary;
};

export type UpdateAccountProfileBody = {
  displayName?: string;
  contact?: string;
};

export type UpdateUserAdminBody = {
  isAdmin?: boolean;
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
