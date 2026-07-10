import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

import {
  defaultAccount,
  defaultAuthSession,
  serverOptions
} from "../defaults.js";
import { AuthProvider, AuthSessionStatus } from "../generated/prisma/client.js";
import type {
  AccountSummary,
  AdminUserSummary,
  AuthSessionSummary,
  EndpointAssignmentSummary,
  LastKnownGoodRouteSummary,
  RouteHealthSnapshotSummary,
  ServerOption,
  SessionState,
  TelemetryFailureReason,
  TelemetryNetworkContext,
  VerificationChallengeProvider
} from "../types.js";

// --------------------------------------------------------------------------
// Errors
// --------------------------------------------------------------------------

export class StoreError extends Error {
  statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
  }
}

// --------------------------------------------------------------------------
// Cloning helpers
// --------------------------------------------------------------------------

export function cloneDefaultState(): SessionState {
  return { ...defaultState };
}

export function cloneDefaultAccount(): AccountSummary {
  return {
    user: { ...defaultAccount.user },
    subscription: { ...defaultAccount.subscription },
    devices: defaultAccount.devices.map((device) => ({ ...device }))
  };
}

export function cloneDefaultAuthSession(): AuthSessionSummary {
  return { ...defaultAuthSession };
}

const defaultState: SessionState = {
  status: "disconnected",
  activeServerId: serverOptions[0].id,
  updatedAt: new Date().toISOString(),
  connectCount: 0
};

// --------------------------------------------------------------------------
// Normalizers
// --------------------------------------------------------------------------

export function isValidServerId(serverId: string) {
  return serverOptions.some((server) => server.id === serverId);
}

export function normalizeSession(input?: Partial<SessionState>): SessionState {
  const fallback = cloneDefaultState();

  if (!input) {
    return fallback;
  }

  return {
    status:
      input.status === "connected" || input.status === "connecting" || input.status === "disconnected"
        ? input.status
        : fallback.status,
    activeServerId:
      typeof input.activeServerId === "string" && isValidServerId(input.activeServerId)
        ? input.activeServerId
        : fallback.activeServerId,
    updatedAt: typeof input.updatedAt === "string" ? input.updatedAt : fallback.updatedAt,
    connectCount: typeof input.connectCount === "number" ? input.connectCount : fallback.connectCount
  };
}

export function normalizeAccount(input?: Partial<AccountSummary>): AccountSummary {
  const fallback = cloneDefaultAccount();
  const user = input?.user;
  const subscription = input?.subscription;
  const devices = input?.devices;

  return {
    user: {
      id: typeof user?.id === "string" ? user.id : fallback.user.id,
      login: typeof user?.login === "string" ? user.login : fallback.user.login,
      displayName: typeof user?.displayName === "string" ? user.displayName : fallback.user.displayName,
      contact: typeof user?.contact === "string" ? user.contact : fallback.user.contact,
      contactType:
        user?.contactType === "telegram" || user?.contactType === "email"
          ? user.contactType
          : fallback.user.contactType,
      isAdmin: typeof user?.isAdmin === "boolean" ? user.isAdmin : fallback.user.isAdmin,
      status:
        user?.status === "active" || user?.status === "blocked" || user?.status === "trial"
          ? user.status
          : fallback.user.status,
      memberSince: typeof user?.memberSince === "string" ? user.memberSince : fallback.user.memberSince
    },
    subscription: {
      plan: typeof subscription?.plan === "string" ? subscription.plan : fallback.subscription.plan,
      renewalDate:
        typeof subscription?.renewalDate === "string"
          ? subscription.renewalDate
          : fallback.subscription.renewalDate,
      status:
        subscription?.status === "active" || subscription?.status === "grace"
          ? subscription.status
          : fallback.subscription.status,
      autoRenew:
        typeof subscription?.autoRenew === "boolean"
          ? subscription.autoRenew
          : fallback.subscription.autoRenew
    },
    devices:
      Array.isArray(devices) && devices.length > 0
        ? devices.map((device, index) => ({
            id: typeof device?.id === "string" ? device.id : `${fallback.devices[0].id}-${index + 1}`,
            name: typeof device?.name === "string" ? device.name : `Device ${index + 1}`,
            platform: typeof device?.platform === "string" ? device.platform : "Unknown",
            lastSeenAt:
              typeof device?.lastSeenAt === "string" ? device.lastSeenAt : fallback.devices[0].lastSeenAt,
            isCurrent: typeof device?.isCurrent === "boolean" ? device.isCurrent : index === 0
          }))
        : fallback.devices
  };
}

/**
 * Определяет, похож ли contact на email (а не на telegram-username).
 * Учитывает: `@telegram_user` → false, `user@gmail.com` → true.
 */
export function trimmedContactLooksLikeEmail(contact: string) {
  return contact.includes("@") && !contact.startsWith("@") && !contact.toLowerCase().includes("telegram");
}

export function normalizeAuthSession(input?: Partial<AuthSessionSummary>): AuthSessionSummary {
  const fallback = cloneDefaultAuthSession();

  return {
    id: typeof input?.id === "string" ? input.id : fallback.id,
    userId: typeof input?.userId === "string" || input?.userId === null ? input.userId : fallback.userId,
    provider:
      input?.provider === "credentials" || input?.provider === "telegram" || input?.provider === "email"
        ? input.provider
        : fallback.provider,
    status:
      input?.status === "active" || input?.status === "revoked" || input?.status === "expired"
        ? input.status
        : fallback.status,
    isAuthenticated: typeof input?.isAuthenticated === "boolean" ? input.isAuthenticated : fallback.isAuthenticated,
    lastAuthenticatedAt:
      typeof input?.lastAuthenticatedAt === "string" || input?.lastAuthenticatedAt === null
        ? input.lastAuthenticatedAt
        : fallback.lastAuthenticatedAt,
    expiresAt: typeof input?.expiresAt === "string" || input?.expiresAt === null ? input.expiresAt : fallback.expiresAt
  };
}

// --------------------------------------------------------------------------
// Mappers (DB row → domain type)
// --------------------------------------------------------------------------

export function mapEndpointRowToServerOption(endpointRow: {
  id: string;
  label: string;
  provider: string;
  asn: number | null;
  ipAddress: string;
  countryCode: string;
  city: string | null;
  transportProfile: string;
  protocol: string;
  latencyMs: number;
  loadPercent: number;
  serverPool: {
    code: string;
    region: string | null;
  };
}): ServerOption {
  return {
    id: endpointRow.id,
    label: endpointRow.label,
    region: endpointRow.serverPool.region ?? endpointRow.city ?? endpointRow.countryCode,
    countryCode: endpointRow.countryCode,
    provider: endpointRow.provider,
    asn: endpointRow.asn,
    ipAddress: endpointRow.ipAddress,
    poolCode: endpointRow.serverPool.code,
    protocol: endpointRow.protocol,
    transportProfile: endpointRow.transportProfile,
    latencyMs: endpointRow.latencyMs,
    loadPercent: endpointRow.loadPercent
  };
}

export function mapAssignmentRowToSummary(assignmentRow: {
  id: string;
  endpointId: string;
  deviceId: string | null;
  assignmentReason: string;
  assignedAt: Date;
  expiresAt: Date | null;
}): EndpointAssignmentSummary {
  return {
    id: assignmentRow.id,
    endpointId: assignmentRow.endpointId,
    deviceId: assignmentRow.deviceId,
    assignmentReason: assignmentRow.assignmentReason,
    assignedAt: assignmentRow.assignedAt.toISOString(),
    expiresAt: assignmentRow.expiresAt?.toISOString() ?? null
  };
}

export function mapLastKnownGoodRouteRowToSummary(routeRow: {
  id: string;
  endpointId: string;
  deviceId: string | null;
  networkFingerprintId: string | null;
  sourceAssignmentReason: string | null;
  lastSucceededAt: Date;
  expiresAt: Date | null;
}): LastKnownGoodRouteSummary {
  return {
    id: routeRow.id,
    endpointId: routeRow.endpointId,
    deviceId: routeRow.deviceId,
    networkFingerprintId: routeRow.networkFingerprintId,
    sourceAssignmentReason: routeRow.sourceAssignmentReason,
    lastSucceededAt: routeRow.lastSucceededAt.toISOString(),
    expiresAt: routeRow.expiresAt?.toISOString() ?? null
  };
}

export type UserWithRelations = import("../generated/prisma/client.js").Prisma.UserGetPayload<{
  include: {
    subscription: true;
    devices: {
      orderBy: {
        createdAt: "asc";
      };
    };
    passwordCredential: true;
  };
}>;

export type AdminUserRow = import("../generated/prisma/client.js").Prisma.UserGetPayload<{
  include: {
    passwordCredential: true;
    authSessions: {
      orderBy: {
        lastAuthenticatedAt: "desc";
      };
      take: 1;
    };
  };
}>;

export function mapAuthSessionRow(sessionRow: {
  id: string;
  userId: string | null;
  provider: AuthProvider;
  status: AuthSessionStatus;
  lastAuthenticatedAt: Date | null;
  expiresAt: Date | null;
} | null): AuthSessionSummary {
  const fallback = cloneDefaultAuthSession();

  if (!sessionRow) {
    return fallback;
  }

  const now = Date.now();
  const expiresAt = sessionRow.expiresAt?.toISOString() ?? null;
  const isExpired = sessionRow.expiresAt ? sessionRow.expiresAt.getTime() <= now : false;
  const status = isExpired ? "expired" : (sessionRow.status as AuthSessionSummary["status"]);

  return {
    id: sessionRow.id,
    userId: sessionRow.userId,
    provider: sessionRow.provider,
    status,
    isAuthenticated: status === "active",
    lastAuthenticatedAt: sessionRow.lastAuthenticatedAt?.toISOString() ?? null,
    expiresAt
  };
}

export function mapUserRowToAccount(userRow: UserWithRelations | null): AccountSummary {
  const fallbackAccount = cloneDefaultAccount();

  if (!userRow) {
    return fallbackAccount;
  }

  return {
    user: {
      id: userRow.id,
      login: userRow.passwordCredential?.login ?? fallbackAccount.user.login,
      displayName: userRow.displayName,
      contact: userRow.contact,
      contactType: userRow.contactType,
      isAdmin: userRow.isAdmin,
      status: userRow.status,
      memberSince: userRow.memberSince.toISOString()
    },
    subscription: userRow.subscription
      ? {
          plan: userRow.subscription.plan,
          renewalDate: userRow.subscription.renewalDate.toISOString(),
          status: userRow.subscription.status,
          autoRenew: userRow.subscription.autoRenew
        }
      : fallbackAccount.subscription,
    devices:
      userRow.devices.length > 0
        ? userRow.devices.map((device) => ({
            id: device.id,
            name: device.name,
            platform: device.platform,
            lastSeenAt: device.lastSeenAt.toISOString(),
            isCurrent: device.isCurrent
          }))
        : []
  };
}

export function mapUserRowToAdminUserSummary(userRow: AdminUserRow): AdminUserSummary {
  return {
    id: userRow.id,
    login: userRow.passwordCredential?.login ?? userRow.contact,
    displayName: userRow.displayName,
    contact: userRow.contact,
    contactType: userRow.contactType,
    isAdmin: userRow.isAdmin,
    opsAlertImmediateEnabled: userRow.opsAlertImmediateEnabled,
    opsAlertDigestEnabled: userRow.opsAlertDigestEnabled,
    opsAlertEscalationTier:
      userRow.opsAlertEscalationTier === "secondary" ? "secondary" : "primary",
    status: userRow.status,
    memberSince: userRow.memberSince.toISOString(),
    lastAuthenticatedAt: userRow.authSessions[0]?.lastAuthenticatedAt?.toISOString() ?? null
  };
}

// --------------------------------------------------------------------------
// Crypto helpers
// --------------------------------------------------------------------------

const scrypt = promisify(scryptCallback);

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const derivedKey = (await scrypt(password, salt, 64)) as Buffer;

  return `${salt}:${derivedKey.toString("hex")}`;
}

export async function verifyPassword(password: string, passwordHash: string) {
  const [salt, expectedHash] = passwordHash.split(":");

  if (!salt || !expectedHash) {
    return false;
  }

  const derivedKey = (await scrypt(password, salt, 64)) as Buffer;
  const expectedBuffer = Buffer.from(expectedHash, "hex");

  if (derivedKey.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(derivedKey, expectedBuffer);
}

// --------------------------------------------------------------------------
// Challenge helpers
// --------------------------------------------------------------------------

export function normalizeVerificationTarget(provider: VerificationChallengeProvider, target: string) {
  const trimmedTarget = target.trim();

  if (provider === "email") {
    return trimmedTarget.toLowerCase();
  }

  return trimmedTarget.startsWith("@") ? trimmedTarget : `@${trimmedTarget}`;
}

// --------------------------------------------------------------------------
// Fingerprint helpers
// --------------------------------------------------------------------------

export function buildNetworkFingerprintHash(input: Pick<TelemetryNetworkContext, "networkType" | "carrier" | "asn" | "countryCode" | "region">) {
  const fingerprintSource = JSON.stringify({
    networkType: input.networkType ?? null,
    carrier: input.carrier?.trim().toLowerCase() || null,
    asn: typeof input.asn === "number" ? input.asn : null,
    countryCode: input.countryCode?.trim().toUpperCase() || null,
    region: input.region?.trim().toLowerCase() || null
  });

  return createHash("sha256").update(fingerprintSource).digest("hex");
}

export type NetworkFingerprintSummary = {
  id: string;
  networkType: string | null;
  carrier: string | null;
  asn: number | null;
  countryCode: string | null;
  region: string | null;
};

export type NetworkSimilarityTier = "exact" | "same_asn" | "same_carrier_country" | "same_country_network_type" | "none";

function normalizeFingerprintText(value: string | null | undefined) {
  return value?.trim().toLowerCase() || null;
}

function normalizeFingerprintCountry(value: string | null | undefined) {
  return value?.trim().toUpperCase() || null;
}

export function classifyNetworkSimilarity(
  target: Pick<NetworkFingerprintSummary, "id" | "networkType" | "carrier" | "asn" | "countryCode">,
  candidate: Pick<NetworkFingerprintSummary, "id" | "networkType" | "carrier" | "asn" | "countryCode">
): NetworkSimilarityTier {
  if (target.id === candidate.id) {
    return "exact";
  }

  if (target.asn !== null && candidate.asn !== null && target.asn === candidate.asn) {
    return "same_asn";
  }

  const targetCountry = normalizeFingerprintCountry(target.countryCode);
  const candidateCountry = normalizeFingerprintCountry(candidate.countryCode);
  const targetCarrier = normalizeFingerprintText(target.carrier);
  const candidateCarrier = normalizeFingerprintText(candidate.carrier);

  if (targetCountry && targetCountry === candidateCountry && targetCarrier && targetCarrier === candidateCarrier) {
    return "same_carrier_country";
  }

  const targetNetworkType = normalizeFingerprintText(target.networkType);
  const candidateNetworkType = normalizeFingerprintText(candidate.networkType);

  if (targetCountry && targetCountry === candidateCountry && targetNetworkType && targetNetworkType === candidateNetworkType) {
    return "same_country_network_type";
  }

  return "none";
}

export function getNetworkLearningWeight(similarityTier: NetworkSimilarityTier) {
  switch (similarityTier) {
    case "exact":
      return 1;
    case "same_asn":
      return 0.45;
    case "same_carrier_country":
      return 0.3;
    case "same_country_network_type":
      return 0.18;
    default:
      return 0;
  }
}

export const telemetryRetentionDays = {
  probeReports: 14,
  routeEvents: 30,
  routeSuccessRollups: 45,
  routeRankings: 7
} as const;

export function createTelemetryRetentionCutoffs(referenceTime: Date = new Date()) {
  const createCutoff = (days: number) => new Date(referenceTime.getTime() - days * 24 * 60 * 60 * 1000);

  return {
    probeReports: createCutoff(telemetryRetentionDays.probeReports),
    routeEvents: createCutoff(telemetryRetentionDays.routeEvents),
    routeSuccessRollups: createCutoff(telemetryRetentionDays.routeSuccessRollups),
    routeRankings: createCutoff(telemetryRetentionDays.routeRankings)
  };
}

// --------------------------------------------------------------------------
// Ranking helpers
// --------------------------------------------------------------------------

export function createCurrentRankingBucket() {
  const now = new Date();
  const bucketEnd = new Date(now);
  bucketEnd.setMinutes(0, 0, 0);
  bucketEnd.setHours(bucketEnd.getHours() + 1);

  const bucketStart = new Date(bucketEnd);
  bucketStart.setHours(bucketStart.getHours() - 24);

  return {
    bucketStart,
    bucketEnd,
    computedAt: now
  };
}

export type RankingProbeSample = {
  result: string;
  failureReason: string | null;
  latencyMs: number | null;
  testedAt: Date;
  sampleWeight?: number;
};

export const failureReasonPenalty: Record<TelemetryFailureReason, number> = {
  timeout: 18,
  handshake_failed: 16,
  connect_refused: 12,
  dns_blocked: 20,
  captive_portal: 20,
  packet_loss_suspected: 10,
  tls_error: 15,
  unknown: 12
};

const severeFailureReasons = new Set<TelemetryFailureReason>([
  "timeout",
  "handshake_failed",
  "dns_blocked",
  "captive_portal",
  "tls_error"
]);

export function getFreshnessWeight(testedAt: Date, referenceTime: Date) {
  const ageHours = Math.max(referenceTime.getTime() - testedAt.getTime(), 0) / (60 * 60 * 1000);

  if (ageHours <= 0.5) {
    return 1;
  }
  if (ageHours <= 2) {
    return 0.85;
  }
  if (ageHours <= 6) {
    return 0.6;
  }
  if (ageHours <= 12) {
    return 0.4;
  }

  return 0.2;
}

function isSevereFailureReason(reason: string | null): reason is TelemetryFailureReason {
  return reason !== null && severeFailureReasons.has(reason as TelemetryFailureReason);
}

export function computeRankingScore(input: {
  successRate: number;
  disconnectRate: number;
  sampleCount: number;
  medianLatency: number | null;
  probes: RankingProbeSample[];
}) {
  const latencyPenalty = input.medianLatency ? Math.min(input.medianLatency / 22, 24) : 7;
  const referenceTime = new Date();
  let failurePenalty = 0;
  let recoveryCredit = 0;

  const timeBuckets = new Set<number>();

  for (const probe of input.probes) {
    const sampleWeight = clampNumber(probe.sampleWeight ?? 1, 0, 1);
    const freshnessWeight = getFreshnessWeight(probe.testedAt, referenceTime);
    const bucketId = Math.floor(probe.testedAt.getTime() / (10 * 60 * 1000));
    timeBuckets.add(bucketId);

    if (probe.result === "connected") {
      recoveryCredit += freshnessWeight * 4 * sampleWeight;
      continue;
    }

    const basePenalty =
      probe.result === "unstable"
        ? 8 + (probe.failureReason === "packet_loss_suspected" ? 3 : 0)
        : failureReasonPenalty[(probe.failureReason ?? "unknown") as TelemetryFailureReason] ?? failureReasonPenalty.unknown;

    failurePenalty += basePenalty * freshnessWeight * sampleWeight;
  }

  const evidenceStrength = Math.min(1.65, 0.55 + input.sampleCount * 0.08 + timeBuckets.size * 0.12);
  const confidenceBonus = Math.min(10, input.sampleCount * 0.55 + timeBuckets.size * 0.75);
  const recentConnected = input.probes.at(-1)?.result === "connected";
  const recencyRecoveryBonus = recentConnected ? 6 : 0;

  return (
    input.successRate * 85 -
    input.disconnectRate * 16 -
    latencyPenalty -
    failurePenalty * evidenceStrength +
    recoveryCredit +
    recencyRecoveryBonus +
    confidenceBonus
  );
}

export function clampNumber(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function computeRouteHealthSnapshots(
  reports: Array<{
    endpointId: string | null;
    result: string;
    failureReason: string | null;
    testedAt: Date;
  }>,
  referenceTime: Date = new Date()
): RouteHealthSnapshotSummary[] {
  const endpointState = new Map<
    string,
    {
      penaltyScore: number;
      recoveryCredit: number;
      freshFailureCount: number;
      freshSevereFailureCount: number;
      sampleCount: number;
      latestResult: string;
      lastFailureAt: Date | null;
      latestSuccessAt: Date | null;
      timeBuckets: Set<number>;
      failureReasonWeights: Map<TelemetryFailureReason, number>;
    }
  >();

  for (const report of reports) {
    if (!report.endpointId) {
      continue;
    }

    const freshnessWeight = getFreshnessWeight(report.testedAt, referenceTime);
    const ageMinutes = Math.max(referenceTime.getTime() - report.testedAt.getTime(), 0) / (60 * 1000);
    const current = endpointState.get(report.endpointId) ?? {
      penaltyScore: 0,
      recoveryCredit: 0,
      freshFailureCount: 0,
      freshSevereFailureCount: 0,
      sampleCount: 0,
      latestResult: report.result,
      lastFailureAt: null,
      latestSuccessAt: null,
      timeBuckets: new Set<number>(),
      failureReasonWeights: new Map<TelemetryFailureReason, number>()
    };

    current.sampleCount += 1;
    current.timeBuckets.add(Math.floor(report.testedAt.getTime() / (10 * 60 * 1000)));

    if (report.result === "connected") {
      current.recoveryCredit += freshnessWeight * 5;
      if (!current.latestSuccessAt || report.testedAt > current.latestSuccessAt) {
        current.latestSuccessAt = report.testedAt;
      }
      endpointState.set(report.endpointId, current);
      continue;
    }

    const failureReason = (report.failureReason ?? "unknown") as TelemetryFailureReason;
    const basePenalty =
      report.result === "unstable"
        ? 8 + (failureReason === "packet_loss_suspected" ? 3 : 0)
        : failureReasonPenalty[failureReason] ?? failureReasonPenalty.unknown;
    const weightedPenalty = basePenalty * freshnessWeight;

    current.penaltyScore += weightedPenalty;
    current.lastFailureAt = !current.lastFailureAt || report.testedAt > current.lastFailureAt ? report.testedAt : current.lastFailureAt;
    current.failureReasonWeights.set(
      failureReason,
      (current.failureReasonWeights.get(failureReason) ?? 0) + weightedPenalty
    );

    if (ageMinutes <= 90) {
      current.freshFailureCount += 1;
      if (isSevereFailureReason(report.failureReason)) {
        current.freshSevereFailureCount += 1;
      }
    }

    endpointState.set(report.endpointId, current);
  }

  return [...endpointState.entries()]
    .map(([endpointId, state]) => {
      const dominantFailureReason =
        [...state.failureReasonWeights.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? null;
      const netPenaltyScore = Math.max(0, state.penaltyScore - state.recoveryCredit);
      const confidence = clampNumber(
        state.sampleCount * 0.12 + state.timeBuckets.size * 0.14 + state.freshFailureCount * 0.18,
        0,
        1
      );
      const hadRecentSuccessAfterFailure =
        Boolean(state.latestSuccessAt && state.lastFailureAt && state.latestSuccessAt >= state.lastFailureAt);
      const status =
        !hadRecentSuccessAfterFailure &&
        (state.freshFailureCount >= 3 || (state.freshFailureCount >= 2 && state.freshSevereFailureCount >= 2))
          ? "avoid"
          : netPenaltyScore >= 8 || state.freshFailureCount > 0
            ? "penalized"
            : "healthy";

      return {
        endpointId,
        penaltyScore: Number(netPenaltyScore.toFixed(2)),
        confidence: Number(confidence.toFixed(2)),
        freshFailureCount: state.freshFailureCount,
        dominantFailureReason,
        lastFailureAt: state.lastFailureAt?.toISOString() ?? null,
        status
      } satisfies RouteHealthSnapshotSummary;
    })
    .sort((left, right) => right.penaltyScore - left.penaltyScore || right.confidence - left.confidence);
}
