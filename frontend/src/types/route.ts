export type TelemetryFailureReason =
  | "timeout"
  | "handshake_failed"
  | "connect_refused"
  | "dns_blocked"
  | "captive_portal"
  | "packet_loss_suspected"
  | "tls_error"
  | "unknown";

export type RouteHealthStatus = "healthy" | "penalized" | "avoid";

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
  selectedBy:
    | "manual_override"
    | "last_known_good"
    | "network_ranking"
    | "baseline_pool_priority"
    | "none";
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

export type RoutePolicy = {
  recommendedEndpointId: string | null;
  recommendedReason: string | null;
  shortlist: RoutePolicyCandidate[];
  trace: RoutePolicyTrace;
};

export type RouteHealthSnapshot = {
  endpointId: string;
  penaltyScore: number;
  confidence: number;
  freshFailureCount: number;
  dominantFailureReason: TelemetryFailureReason | null;
  lastFailureAt: string | null;
  status: RouteHealthStatus;
};

export type TelemetryNetworkContext = {
  networkType: string;
};
