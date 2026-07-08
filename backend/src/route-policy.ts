import type {
  RoutePolicyCandidate,
  RouteHealthSnapshotSummary,
  RoutePolicySummary,
  ServerOption,
  TelemetryNetworkContext
} from "./types.js";

type FailureDomainComparable = Pick<ServerOption, "provider" | "poolCode" | "asn" | "ipAddress" | "protocol" | "transportProfile">;
type FailureDomainComparableWithGeo = Pick<
  ServerOption,
  "provider" | "poolCode" | "asn" | "ipAddress" | "protocol" | "transportProfile" | "countryCode" | "region"
>;

export function hasTelemetryContext(context?: TelemetryNetworkContext) {
  return Boolean(
    context &&
      (context.networkType ||
        context.carrier ||
        typeof context.asn === "number" ||
        context.countryCode ||
        context.region)
  );
}

export function normalizeTelemetryContext(
  input?: Partial<TelemetryNetworkContext> | null
): TelemetryNetworkContext | undefined {
  if (!input) {
    return undefined;
  }

  const normalized: TelemetryNetworkContext = {
    networkType:
      input.networkType === "wifi" || input.networkType === "mobile" || input.networkType === "unknown"
        ? input.networkType
        : undefined,
    carrier: typeof input.carrier === "string" && input.carrier.trim().length > 0 ? input.carrier.trim() : undefined,
    asn: typeof input.asn === "number" && Number.isFinite(input.asn) ? input.asn : undefined,
    countryCode:
      typeof input.countryCode === "string" && input.countryCode.trim().length > 0
        ? input.countryCode.trim().toUpperCase()
        : undefined,
    region: typeof input.region === "string" && input.region.trim().length > 0 ? input.region.trim() : undefined
  };

  return hasTelemetryContext(normalized) ? normalized : undefined;
}

function makeRoutePolicyCandidate(server: ServerOption, assignmentReason: string): RoutePolicyCandidate {
  return {
    endpointId: server.id,
    assignmentReason,
    label: server.label,
    region: server.region,
    provider: server.provider,
    asn: server.asn,
    ipAddress: server.ipAddress,
    poolCode: server.poolCode,
    protocol: server.protocol,
    transportProfile: server.transportProfile,
    latencyMs: server.latencyMs,
    loadPercent: server.loadPercent
  };
}

function hasDifferentTransport(left: FailureDomainComparable, right: FailureDomainComparable) {
  return left.transportProfile !== right.transportProfile || left.protocol !== right.protocol;
}

function hasDifferentIp(left: FailureDomainComparable, right: FailureDomainComparable) {
  return Boolean(left.ipAddress && right.ipAddress && left.ipAddress !== right.ipAddress);
}

function hasDifferentAsn(left: FailureDomainComparable, right: FailureDomainComparable) {
  return left.asn !== null && right.asn !== null && left.asn !== right.asn;
}

function hasDifferentProvider(left: FailureDomainComparable, right: FailureDomainComparable) {
  return left.provider !== right.provider;
}

function hasDifferentPool(left: FailureDomainComparableWithGeo, right: FailureDomainComparableWithGeo) {
  return left.poolCode !== right.poolCode;
}

function hasDifferentRegion(left: FailureDomainComparableWithGeo, right: FailureDomainComparableWithGeo) {
  return left.countryCode !== right.countryCode || left.region !== right.region;
}

function isSameFailureDomain(left: FailureDomainComparableWithGeo, right: FailureDomainComparableWithGeo) {
  return (
    left.provider === right.provider &&
    left.poolCode === right.poolCode &&
    left.asn === right.asn &&
    left.ipAddress === right.ipAddress
  );
}

function isSameRegionalDomain(left: FailureDomainComparableWithGeo, right: FailureDomainComparableWithGeo) {
  return (
    left.provider === right.provider &&
    left.countryCode === right.countryCode &&
    left.region === right.region &&
    left.asn === right.asn
  );
}

function hasIndependentFailureDomain(left: FailureDomainComparableWithGeo, right: FailureDomainComparableWithGeo) {
  return (
    hasDifferentProvider(left, right) ||
    hasDifferentAsn(left, right) ||
    hasDifferentIp(left, right) ||
    hasDifferentPool(left, right) ||
    hasDifferentRegion(left, right)
  );
}

function appendPolicyCandidate(
  shortlist: RoutePolicyCandidate[],
  seenEndpointIds: Set<string>,
  server: ServerOption | undefined,
  assignmentReason: string
) {
  if (!server || seenEndpointIds.has(server.id)) {
    return;
  }

  shortlist.push(makeRoutePolicyCandidate(server, assignmentReason));
  seenEndpointIds.add(server.id);
}

function getRouteHealthPriority(snapshot?: RouteHealthSnapshotSummary) {
  if (!snapshot) {
    return 0;
  }
  if (snapshot.status === "healthy") {
    return 0;
  }
  if (snapshot.status === "penalized") {
    return 1;
  }

  return 2;
}

function getRouteHealthPenaltyScore(snapshot?: RouteHealthSnapshotSummary) {
  return snapshot?.penaltyScore ?? 0;
}

function getRouteHealthConfidence(snapshot?: RouteHealthSnapshotSummary) {
  return snapshot?.confidence ?? 0;
}

function rankServersForSelection(
  servers: ServerOption[],
  routeHealthMap: Map<string, RouteHealthSnapshotSummary>,
  serverOrder: Map<string, number>
) {
  return [...servers].sort((left, right) => {
    const leftHealth = routeHealthMap.get(left.id);
    const rightHealth = routeHealthMap.get(right.id);
    const leftPriority = getRouteHealthPriority(leftHealth);
    const rightPriority = getRouteHealthPriority(rightHealth);

    if (leftPriority !== rightPriority) {
      return leftPriority - rightPriority;
    }
    if ((leftHealth?.penaltyScore ?? 0) !== (rightHealth?.penaltyScore ?? 0)) {
      return (leftHealth?.penaltyScore ?? 0) - (rightHealth?.penaltyScore ?? 0);
    }
    if ((leftHealth?.confidence ?? 0) !== (rightHealth?.confidence ?? 0)) {
      return (leftHealth?.confidence ?? 0) - (rightHealth?.confidence ?? 0);
    }

    return (serverOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (serverOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER);
  });
}

function pickBestMatchingServer(
  servers: ServerOption[],
  seenEndpointIds: Set<string>,
  routeHealthMap: Map<string, RouteHealthSnapshotSummary>,
  serverOrder: Map<string, number>,
  predicate: (server: ServerOption) => boolean
) {
  return rankServersForSelection(servers, routeHealthMap, serverOrder).find(
    (server) => !seenEndpointIds.has(server.id) && predicate(server)
  );
}

function pickBestMatchingServerWithFallback(
  servers: ServerOption[],
  seenEndpointIds: Set<string>,
  routeHealthMap: Map<string, RouteHealthSnapshotSummary>,
  serverOrder: Map<string, number>,
  strictPredicate: (server: ServerOption) => boolean,
  relaxedPredicate: (server: ServerOption) => boolean
) {
  return (
    pickBestMatchingServer(servers, seenEndpointIds, routeHealthMap, serverOrder, strictPredicate) ??
    pickBestMatchingServer(servers, seenEndpointIds, routeHealthMap, serverOrder, relaxedPredicate)
  );
}

/**
 * Решает, стоит ли предпочесть health-предпочтительный сервер primary-кандидату.
 *
 * Confidence (уверенность в health-данных) зависит от свежести репортов с клиентов
 * и количества точек сбора. На старте confidence может быть низким, поэтому
 * код использует защитные пороги:
 * - primaryConfidence >= 0.45 для смены на основании приоритета (priority)
 * - primaryConfidence >= 0.65 для смены на основании разницы штрафов (penalty >= 6)
 *
 * Это предотвращает ложные переключения на ненадёжных данных.
 */
function shouldPreferHealthierPrimary(
  primaryCandidate: ServerOption | undefined,
  healthierCandidate: ServerOption | undefined,
  routeHealthMap: Map<string, RouteHealthSnapshotSummary>
) {
  if (!primaryCandidate || !healthierCandidate || primaryCandidate.id === healthierCandidate.id) {
    return false;
  }

  const primaryHealth = routeHealthMap.get(primaryCandidate.id);
  const healthierHealth = routeHealthMap.get(healthierCandidate.id);
  const primaryPriority = getRouteHealthPriority(primaryHealth);
  const healthierPriority = getRouteHealthPriority(healthierHealth);
  const primaryPenalty = getRouteHealthPenaltyScore(primaryHealth);
  const healthierPenalty = getRouteHealthPenaltyScore(healthierHealth);
  const primaryConfidence = getRouteHealthConfidence(primaryHealth);

  if (primaryPriority === 0) {
    return false;
  }

  if (primaryPriority > healthierPriority && primaryConfidence >= 0.45) {
    return true;
  }

  return primaryPenalty - healthierPenalty >= 6 && primaryConfidence >= 0.65;
}

export function buildRoutePolicy(input: {
  servers: ServerOption[];
  currentAssignmentEndpointId: string | null;
  currentAssignmentReason: string | null;
  lastKnownGoodEndpointId: string | null;
  hasNetworkRanking: boolean;
  routeHealthSnapshots?: RouteHealthSnapshotSummary[];
}): RoutePolicySummary {
  const shortlist: RoutePolicyCandidate[] = [];
  const seenEndpointIds = new Set<string>();
  const routeHealthSnapshots = input.routeHealthSnapshots ?? [];
  const routeHealthMap = new Map(routeHealthSnapshots.map((snapshot) => [snapshot.endpointId, snapshot]));
  const serverOrder = new Map(input.servers.map((server, index) => [server.id, index]));
  const degradedEndpointIds = new Set(
    routeHealthSnapshots.filter((snapshot) => snapshot.status === "avoid").map((snapshot) => snapshot.endpointId)
  );
  const penalizedEndpointCount = routeHealthSnapshots.filter((snapshot) => snapshot.status === "penalized").length;
  const topPenalty = routeHealthSnapshots[0];
  const healthyServers =
    degradedEndpointIds.size > 0
      ? input.servers.filter((server) => !degradedEndpointIds.has(server.id))
      : input.servers;
  const candidateServers = healthyServers.length > 0 ? healthyServers : input.servers;
  const manualOverride =
    input.currentAssignmentReason === "manual_select"
      ? input.servers.find((server) => server.id === input.currentAssignmentEndpointId)
      : undefined;
  const healthRankedCandidateServers = rankServersForSelection(candidateServers, routeHealthMap, serverOrder);
  const lastKnownGood =
    !manualOverride && input.lastKnownGoodEndpointId
      ? candidateServers.find((server) => server.id === input.lastKnownGoodEndpointId) ??
        input.servers.find((server) => server.id === input.lastKnownGoodEndpointId)
      : undefined;
  const primaryRanked = candidateServers[0];
  const primaryHealthPreferred = healthRankedCandidateServers[0];
  const trace: RoutePolicySummary["trace"] = {
    selectedBy: "none",
    usedManualOverride: Boolean(manualOverride),
    usedLastKnownGood: Boolean(lastKnownGood),
    usedNetworkRanking: !manualOverride && !lastKnownGood && input.hasNetworkRanking && Boolean(primaryRanked),
    usedHealthAwarePrimarySelection: false,
    usedRouteHealthPenalties: routeHealthSnapshots.some((snapshot) => snapshot.status !== "healthy"),
    usedHealthAwareShortlist: routeHealthSnapshots.length > 0,
    usedDegradedAvoidance: degradedEndpointIds.size > 0 && healthyServers.length > 0,
    routeHealthAvoidedCount: degradedEndpointIds.size,
    routeHealthPenalizedCount: penalizedEndpointCount,
    degradedEndpointCount: degradedEndpointIds.size,
    fallbackTier: "none",
    diversityStageReached: "none",
    shortlistDistinctProviders: 0,
    shortlistDistinctAsns: 0,
    shortlistPenalizedCount: 0,
    topPenaltyReason: topPenalty?.dominantFailureReason ?? null,
    topPenaltyConfidence: topPenalty?.confidence ?? null,
    recommendedEndpointHealth: "unknown",
    recommendedEndpointPenaltyScore: null,
    recommendedEndpointFailureReason: null,
    primaryCandidateEndpointId: null,
    primaryCandidateHealth: "unknown",
    primaryCandidatePenaltyScore: null,
    healthAdjustedPrimaryEndpointId: null
  };

  appendPolicyCandidate(shortlist, seenEndpointIds, manualOverride, "manual_override");

  if (manualOverride) {
    trace.selectedBy = "manual_override";
    trace.fallbackTier = "manual";
  }

  if (!manualOverride) {
    const defaultPrimary = lastKnownGood ?? primaryRanked;
    const primaryCandidate = shouldPreferHealthierPrimary(defaultPrimary, primaryHealthPreferred, routeHealthMap)
      ? primaryHealthPreferred
      : defaultPrimary;

    trace.primaryCandidateEndpointId = defaultPrimary?.id ?? null;
    if (defaultPrimary) {
      const defaultPrimaryHealth = routeHealthMap.get(defaultPrimary.id);
      trace.primaryCandidateHealth = defaultPrimaryHealth?.status ?? "unknown";
      trace.primaryCandidatePenaltyScore = defaultPrimaryHealth?.penaltyScore ?? null;
    }
    trace.healthAdjustedPrimaryEndpointId =
      primaryCandidate && defaultPrimary && primaryCandidate.id !== defaultPrimary.id ? primaryCandidate.id : null;
    trace.usedHealthAwarePrimarySelection = Boolean(trace.healthAdjustedPrimaryEndpointId);

    if (lastKnownGood) {
      trace.selectedBy = "last_known_good";
      trace.fallbackTier = "last_known_good";
    } else if (input.hasNetworkRanking && primaryRanked) {
      trace.selectedBy = "network_ranking";
      trace.fallbackTier = "ranking";
    } else if (primaryRanked) {
      trace.selectedBy = "baseline_pool_priority";
      trace.fallbackTier = "baseline";
    }

    appendPolicyCandidate(
      shortlist,
      seenEndpointIds,
      primaryCandidate,
      trace.usedHealthAwarePrimarySelection
        ? "route_health_adjusted_primary"
        : lastKnownGood
          ? "last_known_good"
          : input.hasNetworkRanking
            ? "network_ranking_primary"
            : "baseline_pool_priority"
    );
  }

  const primary = shortlist[0];
  const primaryServer = primary ? input.servers.find((server) => server.id === primary.endpointId) : undefined;
  const secondChoice = primaryServer
    ? pickBestMatchingServerWithFallback(
        candidateServers,
        seenEndpointIds,
        routeHealthMap,
        serverOrder,
        (server) =>
          !isSameRegionalDomain(server, primaryServer) &&
          ((hasDifferentTransport(server, primaryServer) && hasIndependentFailureDomain(server, primaryServer)) ||
            hasDifferentIp(server, primaryServer) ||
            hasDifferentRegion(server, primaryServer) ||
            hasDifferentPool(server, primaryServer) ||
            hasDifferentProvider(server, primaryServer) ||
            hasDifferentAsn(server, primaryServer)),
        (server) =>
          (hasDifferentTransport(server, primaryServer) && hasIndependentFailureDomain(server, primaryServer)) ||
          (hasDifferentTransport(server, primaryServer) && !isSameFailureDomain(server, primaryServer)) ||
          hasDifferentIp(server, primaryServer) ||
          hasDifferentRegion(server, primaryServer)
      )
    : undefined;
  appendPolicyCandidate(shortlist, seenEndpointIds, secondChoice, "transport_diagnostic_fallback");

  const diversityAnchor = primaryServer;
  const providerDiversity = diversityAnchor
    ? pickBestMatchingServer(
        candidateServers,
        seenEndpointIds,
        routeHealthMap,
        serverOrder,
        (server) =>
          hasDifferentProvider(server, diversityAnchor) &&
          !isSameRegionalDomain(server, diversityAnchor) &&
          (hasDifferentAsn(server, diversityAnchor) ||
            hasDifferentIp(server, diversityAnchor) ||
            hasDifferentPool(server, diversityAnchor) ||
            hasDifferentRegion(server, diversityAnchor))
      )
    : undefined;
  appendPolicyCandidate(shortlist, seenEndpointIds, providerDiversity, "provider_diversity_fallback");

  const asnDiversity = diversityAnchor
    ? pickBestMatchingServer(
        candidateServers,
        seenEndpointIds,
        routeHealthMap,
        serverOrder,
        (server) =>
          hasIndependentFailureDomain(server, diversityAnchor) &&
          !isSameRegionalDomain(server, diversityAnchor) &&
          (hasDifferentAsn(server, diversityAnchor) ||
            hasDifferentProvider(server, diversityAnchor) ||
            hasDifferentPool(server, diversityAnchor) ||
            hasDifferentRegion(server, diversityAnchor))
      )
    : undefined;
  appendPolicyCandidate(shortlist, seenEndpointIds, asnDiversity, "asn_diversity_fallback");

  const emergencyPreferred = diversityAnchor
    ? healthRankedCandidateServers.filter(
        (server) =>
          !seenEndpointIds.has(server.id) &&
          hasIndependentFailureDomain(server, diversityAnchor) &&
          !isSameRegionalDomain(server, diversityAnchor)
      )
    : [];
  const emergencyRemaining = healthRankedCandidateServers.filter((server) => !seenEndpointIds.has(server.id));

  for (const server of [...emergencyPreferred, ...emergencyRemaining]) {
    if (shortlist.length >= 4) {
      break;
    }

    appendPolicyCandidate(shortlist, seenEndpointIds, server, "emergency_fallback");
  }

  if (shortlist.length === 0 && candidateServers !== input.servers) {
    for (const server of rankServersForSelection(input.servers, routeHealthMap, serverOrder)) {
      if (shortlist.length >= 4) {
        break;
      }

      appendPolicyCandidate(shortlist, seenEndpointIds, server, "emergency_fallback");
    }
  }

  const distinctProviders = new Set(shortlist.map((candidate) => candidate.provider)).size;
  const distinctAsns = new Set(shortlist.map((candidate) => candidate.asn).filter((asn) => asn !== null)).size;
  const uniqueFailureDomains = new Set(
    shortlist.map((candidate) => `${candidate.provider}:${candidate.poolCode}:${candidate.asn ?? "na"}:${candidate.ipAddress ?? "na"}`)
  ).size;

  trace.shortlistDistinctProviders = distinctProviders;
  trace.shortlistDistinctAsns = distinctAsns;
  trace.shortlistPenalizedCount = shortlist.filter((candidate) => {
    const snapshot = routeHealthMap.get(candidate.endpointId);

    return snapshot && snapshot.status !== "healthy";
  }).length;
  trace.diversityStageReached =
    shortlist.length === 0
      ? "none"
      : uniqueFailureDomains === shortlist.length && distinctProviders >= 2
        ? "strict"
        : uniqueFailureDomains >= Math.min(shortlist.length, 2)
        ? "partial"
        : "same_domain_only";

  const recommendedHealth = shortlist[0] ? routeHealthMap.get(shortlist[0].endpointId) : undefined;
  if (recommendedHealth) {
    trace.recommendedEndpointHealth = recommendedHealth.status;
    trace.recommendedEndpointPenaltyScore = recommendedHealth.penaltyScore;
    trace.recommendedEndpointFailureReason = recommendedHealth.dominantFailureReason;
  }

  return {
    recommendedEndpointId: shortlist[0]?.endpointId ?? null,
    recommendedReason: shortlist[0]?.assignmentReason ?? null,
    shortlist,
    trace
  };
}
