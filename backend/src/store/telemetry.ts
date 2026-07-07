import { randomUUID } from "node:crypto";

import type { Prisma, PrismaClient } from "../generated/prisma/client.js";
import type {
  AuthSessionSummary,
  RecordRouteFeedbackInput,
  RouteHealthSnapshotSummary,
  TelemetryFailureReason,
  TelemetryNetworkContext,
  TelemetryProbeResult
} from "../types.js";
import {
  computeRouteHealthSnapshots
} from "./utils.js";
import {
  findBestAvailableRankingFingerprintId,
  pruneTelemetryData,
  recomputeAnalyticsForFingerprint,
  resolveNetworkFingerprintId
} from "./shared.js";

// --------------------------------------------------------------------------
// TelemetryStore
// --------------------------------------------------------------------------

export function createTelemetryStore(prisma: PrismaClient) {
  return {
    async submitProbeReport(
      auth: AuthSessionSummary,
      input: {
        results: Array<{
          endpointId: string;
          transportProfile: string;
          result: TelemetryProbeResult;
          failureReason?: TelemetryFailureReason | null;
          latencyMs?: number | null;
          bytesSent?: number | null;
          bytesReceived?: number | null;
          appVersion?: string | null;
          testedAt?: string | null;
        }>;
        context?: TelemetryNetworkContext | null;
      }
    ): Promise<void> {
      if (!input.results.length) {
        return;
      }

      const networkFingerprintId = await resolveNetworkFingerprintId(prisma, input.context ?? undefined);

      await prisma.probeReport.createMany({
        data: input.results.map((result) => ({
          id: randomUUID(),
          endpointId: result.endpointId,
          transportProfile: result.transportProfile,
          result: result.result as TelemetryProbeResult,
          failureReason: result.failureReason ?? null,
          latencyMs: typeof result.latencyMs === "number" ? result.latencyMs : null,
          bytesSent: typeof result.bytesSent === "number" ? BigInt(Math.trunc(result.bytesSent)) : null,
          bytesReceived: typeof result.bytesReceived === "number" ? BigInt(Math.trunc(result.bytesReceived)) : null,
          appVersion: result.appVersion ?? null,
          testedAt: result.testedAt ? new Date(result.testedAt) : new Date(),
          networkFingerprintId,
          userId: auth.userId ?? null,
          deviceId: null
        }))
      });

      // Recompute rankings if we have a network fingerprint
      if (networkFingerprintId) {
        await recomputeAnalyticsForFingerprint(prisma, networkFingerprintId);
      }

      await pruneTelemetryData(prisma);
    },

    async recordRouteFeedback(auth: AuthSessionSummary, input: RecordRouteFeedbackInput): Promise<void> {
      const networkFingerprintId = await resolveNetworkFingerprintId(prisma, {
        networkType: input.networkType,
        carrier: input.carrier,
        asn: input.asn,
        countryCode: input.countryCode,
        region: input.region
      });

      await prisma.routeEvent.create({
        data: {
          id: randomUUID(),
          userId: auth.userId ?? null,
          networkFingerprintId,
          endpointId: input.endpointId,
          eventType: "route_feedback",
          feedbackResult: input.result,
          eventReason: input.failureReason ?? null,
          metadata: {
            appVersion: input.appVersion ?? null,
            note: input.note ?? null,
            source: input.source ?? "manual_report",
            latencyMs: typeof input.latencyMs === "number" ? input.latencyMs : null
          },
          transportProfile: input.transportProfile,
          occurredAt: new Date(input.occurredAt),
          receivedAt: new Date()
        }
      });

      await prisma.probeReport.create({
        data: {
          id: randomUUID(),
          userId: auth.userId ?? null,
          deviceId: null,
          networkFingerprintId,
          endpointId: input.endpointId,
          transportProfile: input.transportProfile,
          result: input.result,
          failureReason: input.failureReason ?? null,
          latencyMs: typeof input.latencyMs === "number" ? input.latencyMs : null,
          appVersion: input.appVersion ?? null,
          testedAt: new Date(input.occurredAt)
        }
      });

      if (networkFingerprintId) {
        await recomputeAnalyticsForFingerprint(prisma, networkFingerprintId);
      }

      await pruneTelemetryData(prisma);
    },

    async recordRouteWorkflowSnapshot(
      auth: AuthSessionSummary,
      input: {
        context?: TelemetryNetworkContext;
        note?: string | null;
        candidateLimit: number;
        recommendedEndpointId: string | null;
        candidates: Array<{
          endpointId: string;
          transportProfile: string;
          assignmentReason: string;
          healthStatus: string;
          penaltyScore: number | null;
          dominantFailureReason: string | null;
        }>;
        routePolicy: {
          recommendedReason: string | null;
          trace: Record<string, unknown>;
        };
      }
    ): Promise<void> {
      const networkFingerprintId = await resolveNetworkFingerprintId(prisma, input.context);
      const metadata = JSON.parse(JSON.stringify({
        candidateLimit: input.candidateLimit,
        recommendedReason: input.routePolicy.recommendedReason,
        trace: input.routePolicy.trace,
        candidates: input.candidates
      })) as Prisma.InputJsonValue;

      await prisma.routeEvent.create({
        data: {
          id: randomUUID(),
          userId: auth.userId ?? null,
          networkFingerprintId,
          endpointId: input.recommendedEndpointId,
          eventType: "runtime_reprobe_resolve",
          feedbackResult: null,
          eventReason: input.note ?? null,
          metadata,
          transportProfile: "background_resolve",
          occurredAt: new Date(),
          receivedAt: new Date()
        }
      });

      await pruneTelemetryData(prisma);
    },

    async getHealthSnapshots(auth: AuthSessionSummary, context?: TelemetryNetworkContext): Promise<RouteHealthSnapshotSummary[]> {
      if (!auth.userId) {
        return [];
      }

      const networkFingerprintId = context ? await findBestAvailableRankingFingerprintId(prisma, context) : null;

      const hoursBack = 2;
      const sinceDate = new Date(Date.now() - hoursBack * 60 * 60 * 1000);

      const reports = await prisma.probeReport.findMany({
        where: {
          userId: auth.userId,
          ...(networkFingerprintId ? { networkFingerprintId } : {}),
          testedAt: {
            gte: sinceDate
          },
          endpointId: {
            not: null
          }
        },
        orderBy: {
          testedAt: "asc"
        },
        select: {
          endpointId: true,
          result: true,
          failureReason: true,
          testedAt: true
        }
      });

      return computeRouteHealthSnapshots(reports);
    },

    async getRankings(auth: AuthSessionSummary, context?: TelemetryNetworkContext): Promise<Array<{ endpointId: string; score: number; rankPosition: number }>> {
      if (!auth.userId) {
        return [];
      }

      const networkFingerprintId = context ? await findBestAvailableRankingFingerprintId(prisma, context) : null;

      if (networkFingerprintId) {
        const rankings = await prisma.routeRanking.findMany({
          where: {
            networkFingerprintId,
            expiresAt: {
              gt: new Date()
            }
          },
          orderBy: {
            rankPosition: "asc"
          },
          select: {
            endpointId: true,
            score: true,
            rankPosition: true
          }
        });

        if (rankings.length > 0) {
          return rankings
            .filter((r) => r.endpointId !== null)
            .map((ranking) => ({
              endpointId: ranking.endpointId as string,
              score: Number(ranking.score),
              rankPosition: ranking.rankPosition
            }));
        }
      }

      // Fallback: look for any rankings associated with this user's probes
      const userFingerprints = await prisma.probeReport.groupBy({
        by: ["networkFingerprintId"],
        where: {
          userId: auth.userId,
          networkFingerprintId: {
            not: null
          }
        },
        _count: {
          id: true
        },
        orderBy: {
          _count: {
            id: "desc"
          }
        },
        take: 1
      });

      const fallbackFingerprintId = userFingerprints[0]?.networkFingerprintId;

      if (fallbackFingerprintId) {
        const rankings = await prisma.routeRanking.findMany({
          where: {
            networkFingerprintId: fallbackFingerprintId,
            expiresAt: {
              gt: new Date()
            }
          },
          orderBy: {
            rankPosition: "asc"
          },
          select: {
            endpointId: true,
            score: true,
            rankPosition: true
          }
        });

        return rankings
          .filter((r) => r.endpointId !== null)
          .map((ranking) => ({
            endpointId: ranking.endpointId as string,
            score: Number(ranking.score),
            rankPosition: ranking.rankPosition
          }));
      }

      return [];
    }
  };
}
