import { randomUUID } from "node:crypto";

import type { PrismaClient } from "../generated/prisma/client.js";
import { ContactType } from "../generated/prisma/client.js";
import type { TelemetryNetworkContext, VerificationChallengeProvider } from "../types.js";
import {
  mapUserRowToAccount,
  mapUserRowToAdminUserSummary,
  buildNetworkFingerprintHash,
  computeRankingScore,
  createCurrentRankingBucket,
  classifyNetworkSimilarity,
  createTelemetryRetentionCutoffs,
  getNetworkLearningWeight,
  type NetworkFingerprintSummary
} from "./utils.js";
import type { RankingProbeSample } from "./utils.js";

// --------------------------------------------------------------------------
// Shared Prisma-dependent helpers used by multiple stores
// --------------------------------------------------------------------------

export async function loadUserAccountById(prisma: PrismaClient, userId: string) {
  const userRow = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      subscription: true,
      devices: {
        orderBy: {
          createdAt: "asc"
        }
      },
      passwordCredential: true
    }
  });

  return mapUserRowToAccount(userRow);
}

export async function loadAdminUsers(prisma: PrismaClient) {
  const userRows = await prisma.user.findMany({
    include: {
      passwordCredential: true,
      authSessions: {
        orderBy: {
          lastAuthenticatedAt: "desc"
        },
        take: 1
      }
    },
    orderBy: [
      {
        isAdmin: "desc"
      },
      {
        memberSince: "asc"
      }
    ]
  });

  return userRows.map(mapUserRowToAdminUserSummary);
}

export async function findUserByVerificationTarget(prisma: PrismaClient, provider: VerificationChallengeProvider, target: string) {
  return prisma.user.findFirst({
    where: {
      contactType: provider === "email" ? ContactType.email : ContactType.telegram,
      contact: target
    },
    include: {
      subscription: true,
      devices: {
        orderBy: {
          createdAt: "asc"
        }
      },
      passwordCredential: true
    }
  });
}

export async function findCurrentDeviceId(prisma: PrismaClient, userId: string) {
  const currentDevice = await prisma.device.findFirst({
    where: {
      userId,
      isCurrent: true
    },
    select: {
      id: true
    },
    orderBy: {
      createdAt: "asc"
    }
  });

  return currentDevice?.id ?? null;
}

export async function resolveNetworkFingerprintId(prisma: PrismaClient, input?: TelemetryNetworkContext) {
  if (!input) {
    return null;
  }

  const fingerprintHash = buildNetworkFingerprintHash(input);
  const networkFingerprint = await prisma.networkFingerprint.upsert({
    where: {
      fingerprintHash
    },
    update: {
      networkType: input.networkType ?? null,
      carrier: input.carrier?.trim() ?? null,
      asn: typeof input.asn === "number" ? input.asn : null,
      countryCode: input.countryCode?.trim().toUpperCase() ?? null,
      region: input.region?.trim() ?? null
    },
    create: {
      id: randomUUID(),
      fingerprintHash,
      networkType: input.networkType ?? null,
      carrier: input.carrier?.trim() ?? null,
      asn: typeof input.asn === "number" ? input.asn : null,
      countryCode: input.countryCode?.trim().toUpperCase() ?? null,
      region: input.region?.trim() ?? null
    },
    select: {
      id: true
    }
  });

  return networkFingerprint.id;
}

export async function findNetworkFingerprintId(prisma: PrismaClient, input?: TelemetryNetworkContext) {
  if (!input) {
    return null;
  }

  const fingerprintHash = buildNetworkFingerprintHash(input);
  const networkFingerprint = await prisma.networkFingerprint.findUnique({
    where: {
      fingerprintHash
    },
    select: {
      id: true
    }
  });

  return networkFingerprint?.id ?? null;
}

async function listComparableNetworkFingerprints(
  prisma: PrismaClient,
  target: NetworkFingerprintSummary
): Promise<NetworkFingerprintSummary[]> {
  const orClauses = [
    target.asn !== null
      ? {
          asn: target.asn
        }
      : null,
    target.countryCode && target.carrier
      ? {
          countryCode: target.countryCode,
          carrier: target.carrier
        }
      : null,
    target.countryCode && target.networkType
      ? {
          countryCode: target.countryCode,
          networkType: target.networkType
        }
      : null
  ].filter((clause): clause is NonNullable<typeof clause> => clause !== null);

  if (orClauses.length === 0) {
    return [target];
  }

  const fingerprints = await prisma.networkFingerprint.findMany({
    where: {
      OR: orClauses
    },
    select: {
      id: true,
      networkType: true,
      carrier: true,
      asn: true,
      countryCode: true,
      region: true
    }
  });

  return fingerprints;
}

async function listRankedLearningSources(prisma: PrismaClient, target: NetworkFingerprintSummary) {
  const candidates = await listComparableNetworkFingerprints(prisma, target);

  return candidates
    .map((candidate) => {
      const similarityTier = classifyNetworkSimilarity(target, candidate);
      const learningWeight = getNetworkLearningWeight(similarityTier);

      return {
        ...candidate,
        similarityTier,
        learningWeight
      };
    })
    .filter((candidate) => candidate.learningWeight > 0)
    .sort((left, right) => right.learningWeight - left.learningWeight || left.id.localeCompare(right.id))
    .slice(0, 6);
}

function computeWeightedMedian(values: Array<{ value: number; weight: number }>) {
  if (values.length === 0) {
    return null;
  }

  const sorted = [...values].sort((left, right) => left.value - right.value);
  const totalWeight = sorted.reduce((sum, entry) => sum + entry.weight, 0);
  const threshold = totalWeight / 2;
  let runningWeight = 0;

  for (const entry of sorted) {
    runningWeight += entry.weight;
    if (runningWeight >= threshold) {
      return entry.value;
    }
  }

  return sorted.at(-1)?.value ?? null;
}

export async function findBestAvailableRankingFingerprintId(prisma: PrismaClient, input?: TelemetryNetworkContext) {
  if (!input) {
    return null;
  }

  const fingerprintHash = buildNetworkFingerprintHash(input);
  const exactFingerprint = await prisma.networkFingerprint.findUnique({
    where: {
      fingerprintHash
    },
    select: {
      id: true,
      networkType: true,
      carrier: true,
      asn: true,
      countryCode: true,
      region: true
    }
  });

  const fallbackTarget: NetworkFingerprintSummary = exactFingerprint ?? {
    id: fingerprintHash,
    networkType: input.networkType ?? null,
    carrier: input.carrier?.trim() ?? null,
    asn: typeof input.asn === "number" ? input.asn : null,
    countryCode: input.countryCode?.trim().toUpperCase() ?? null,
    region: input.region?.trim() ?? null
  };

  const candidates = await listRankedLearningSources(prisma, fallbackTarget);
  const candidateIds = candidates
    .map((candidate) => candidate.id)
    .filter((candidateId) => candidateId !== fingerprintHash);

  if (candidateIds.length === 0) {
    return exactFingerprint?.id ?? null;
  }

  const liveRankings = await prisma.routeRanking.findMany({
    where: {
      networkFingerprintId: {
        in: candidateIds
      },
      expiresAt: {
        gt: new Date()
      }
    },
    select: {
      networkFingerprintId: true,
      computedAt: true
    }
  });

  if (liveRankings.length === 0) {
    return exactFingerprint?.id ?? null;
  }

  const rankingFreshness = new Map<string, Date>();
  for (const ranking of liveRankings) {
    if (!ranking.networkFingerprintId) {
      continue;
    }

    const current = rankingFreshness.get(ranking.networkFingerprintId);
    if (!current || ranking.computedAt > current) {
      rankingFreshness.set(ranking.networkFingerprintId, ranking.computedAt);
    }
  }

  const rankedCandidate = candidates
    .filter((candidate) => rankingFreshness.has(candidate.id))
    .sort((left, right) => {
      if (left.learningWeight !== right.learningWeight) {
        return right.learningWeight - left.learningWeight;
      }

      return (
        (rankingFreshness.get(right.id)?.getTime() ?? 0) - (rankingFreshness.get(left.id)?.getTime() ?? 0)
      );
    })[0];

  return rankedCandidate?.id ?? exactFingerprint?.id ?? null;
}

export async function pruneTelemetryData(prisma: PrismaClient, referenceTime: Date = new Date()) {
  const cutoffs = createTelemetryRetentionCutoffs(referenceTime);

  await prisma.$transaction([
    prisma.probeReport.deleteMany({
      where: {
        testedAt: {
          lt: cutoffs.probeReports
        }
      }
    }),
    prisma.routeEvent.deleteMany({
      where: {
        occurredAt: {
          lt: cutoffs.routeEvents
        }
      }
    }),
    prisma.routeSuccessRollup.deleteMany({
      where: {
        timeBucketEnd: {
          lt: cutoffs.routeSuccessRollups
        }
      }
    }),
    prisma.routeRanking.deleteMany({
      where: {
        computedAt: {
          lt: cutoffs.routeRankings
        }
      }
    })
  ]);
}

export async function recomputeAnalyticsForFingerprint(prisma: PrismaClient, networkFingerprintId: string) {
  const { bucketStart, bucketEnd, computedAt } = createCurrentRankingBucket();
  const targetFingerprint = await prisma.networkFingerprint.findUnique({
    where: {
      id: networkFingerprintId
    },
    select: {
      id: true,
      networkType: true,
      carrier: true,
      asn: true,
      countryCode: true,
      region: true
    }
  });

  if (!targetFingerprint) {
    return;
  }

  const learningSources = await listRankedLearningSources(prisma, targetFingerprint);
  const learningWeightByFingerprintId = new Map(
    learningSources.map((source) => [source.id, source.learningWeight])
  );
  const probeReports = await prisma.probeReport.findMany({
    where: {
      networkFingerprintId: {
        in: learningSources.map((source) => source.id)
      },
      testedAt: {
        gte: bucketStart,
        lt: bucketEnd
      },
      endpointId: {
        not: null
      }
    },
    orderBy: {
      testedAt: "asc"
    },
    select: {
      networkFingerprintId: true,
      endpointId: true,
      transportProfile: true,
      result: true,
      failureReason: true,
      latencyMs: true,
      testedAt: true
    }
  });

  const groupedReports = new Map<
    string,
    {
      endpointId: string;
      transportProfile: string;
      weightedSampleCount: number;
      weightedSuccessCount: number;
      weightedDisconnectCount: number;
      latencies: Array<{ value: number; weight: number }>;
      probes: RankingProbeSample[];
    }
  >();

  for (const report of probeReports) {
    if (!report.endpointId) {
      continue;
    }

    const key = `${report.endpointId}:${report.transportProfile}`;
    const learningWeight = learningWeightByFingerprintId.get(report.networkFingerprintId ?? "") ?? 0;

    if (learningWeight <= 0) {
      continue;
    }

    const existing = groupedReports.get(key) ?? {
      endpointId: report.endpointId,
      transportProfile: report.transportProfile,
      weightedSampleCount: 0,
      weightedSuccessCount: 0,
      weightedDisconnectCount: 0,
      latencies: [],
      probes: []
    };

    existing.weightedSampleCount += learningWeight;
    if (report.result === "connected") {
      existing.weightedSuccessCount += learningWeight;
    }
    if (report.result === "unstable") {
      existing.weightedDisconnectCount += learningWeight;
    }
    existing.probes.push({
      result: report.result,
      failureReason: report.failureReason,
      latencyMs: report.latencyMs,
      testedAt: report.testedAt,
      sampleWeight: learningWeight
    });

    if (typeof report.latencyMs === "number" && report.result === "connected") {
      existing.latencies.push({
        value: report.latencyMs,
        weight: learningWeight
      });
    }

    groupedReports.set(key, existing);
  }

  await prisma.$transaction(async (tx) => {
    await tx.routeSuccessRollup.deleteMany({
      where: {
        networkFingerprintId,
        timeBucketEnd: bucketEnd
      }
    });

    await tx.routeRanking.deleteMany({
      where: {
        networkFingerprintId,
        expiresAt: bucketEnd
      }
    });

    const rollups: Array<{
      endpointId: string;
      transportProfile: string;
      successRate: number;
      disconnectRate: number;
      sampleCount: number;
      medianLatency: number | null;
      score: number;
    }> = [];

    for (const group of groupedReports.values()) {
      const sampleCount = group.weightedSampleCount;
      const medianLatency = computeWeightedMedian(group.latencies);
      const successRate = sampleCount > 0 ? group.weightedSuccessCount / sampleCount : 0;
      const disconnectRate = sampleCount > 0 ? group.weightedDisconnectCount / sampleCount : 0;
      const score = computeRankingScore({
        successRate,
        disconnectRate,
        sampleCount,
        medianLatency,
        probes: group.probes
      });

      rollups.push({
        endpointId: group.endpointId,
        transportProfile: group.transportProfile,
        successRate,
        disconnectRate,
        sampleCount: Math.max(1, Math.round(sampleCount)),
        medianLatency,
        score
      });

      await tx.routeSuccessRollup.create({
        data: {
          id: randomUUID(),
          timeBucketStart: bucketStart,
          timeBucketEnd: bucketEnd,
          networkFingerprintId,
          endpointId: group.endpointId,
          transportProfile: group.transportProfile,
          successRate: successRate.toFixed(4),
          medianConnectTimeMs: medianLatency,
          disconnectRate: disconnectRate.toFixed(4),
          sampleCount: Math.max(1, Math.round(sampleCount)),
          computedAt
        }
      });
    }

    const ranked = rollups.sort((left, right) => right.score - left.score);

    for (const [index, rollup] of ranked.entries()) {
      await tx.routeRanking.create({
        data: {
          id: randomUUID(),
          networkFingerprintId,
          endpointId: rollup.endpointId,
          transportProfile: rollup.transportProfile,
          score: rollup.score.toFixed(4),
          rankPosition: index + 1,
          computedAt,
          expiresAt: bucketEnd
        }
      });
    }
  });
}
