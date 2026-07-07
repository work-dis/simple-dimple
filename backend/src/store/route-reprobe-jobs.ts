import { randomUUID } from "node:crypto";

import type { Prisma, PrismaClient, RouteReprobeJob } from "../generated/prisma/client.js";
import type {
  RouteReprobeJobAttemptAuditEntry,
  RouteReprobeCandidateSummary,
  RouteReprobeJobBody,
  RouteReprobeJobSummary,
  RouteReprobeJobStatus,
  RouteHealthStatus,
  RouteReprobeResultBody,
  TelemetryFailureReason,
  TelemetryNetworkContext
} from "../types.js";

export type ClaimedRouteReprobeJob = RouteReprobeJobSummary & {
  appVersion: string | null;
  results: RouteReprobeResultBody[];
  workerId: string | null;
};

const defaultMaxAttempts = 3;

function asJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mapContext(value: unknown): TelemetryNetworkContext {
  if (!isRecord(value)) {
    return {};
  }

  return {
    networkType:
      value.networkType === "wifi" || value.networkType === "mobile" || value.networkType === "unknown"
        ? value.networkType
        : undefined,
    carrier: typeof value.carrier === "string" ? value.carrier : undefined,
    asn: typeof value.asn === "number" ? value.asn : undefined,
    countryCode: typeof value.countryCode === "string" ? value.countryCode : undefined,
    region: typeof value.region === "string" ? value.region : undefined
  };
}

function mapResults(value: unknown): RouteReprobeResultBody[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const results: RouteReprobeResultBody[] = [];

  for (const entry of value) {
    if (!isRecord(entry)) {
      continue;
    }

    results.push({
      endpointId: typeof entry.endpointId === "string" ? entry.endpointId : undefined,
      transportProfile: typeof entry.transportProfile === "string" ? entry.transportProfile : undefined,
      result:
        entry.result === "connected" || entry.result === "unstable" || entry.result === "failed"
          ? entry.result
          : undefined,
      failureReason:
        entry.failureReason === "timeout" ||
        entry.failureReason === "handshake_failed" ||
        entry.failureReason === "connect_refused" ||
        entry.failureReason === "dns_blocked" ||
        entry.failureReason === "captive_portal" ||
        entry.failureReason === "packet_loss_suspected" ||
        entry.failureReason === "tls_error" ||
        entry.failureReason === "unknown"
          ? (entry.failureReason as TelemetryFailureReason)
          : undefined,
      latencyMs: typeof entry.latencyMs === "number" ? entry.latencyMs : undefined,
      occurredAt: typeof entry.occurredAt === "string" ? entry.occurredAt : undefined
    });
  }

  return results;
}

function mapCandidates(value: unknown): RouteReprobeCandidateSummary[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const candidates: RouteReprobeCandidateSummary[] = [];

  for (const entry of value) {
    if (!isRecord(entry)) {
      continue;
    }

    candidates.push({
      endpointId: typeof entry.endpointId === "string" ? entry.endpointId : "",
      transportProfile: typeof entry.transportProfile === "string" ? entry.transportProfile : "",
      assignmentReason: typeof entry.assignmentReason === "string" ? entry.assignmentReason : "",
      provider: typeof entry.provider === "string" ? entry.provider : "",
      region: typeof entry.region === "string" ? entry.region : "",
      healthStatus:
        entry.healthStatus === "healthy" ||
        entry.healthStatus === "penalized" ||
        entry.healthStatus === "avoid" ||
        entry.healthStatus === "unknown"
          ? (entry.healthStatus as RouteHealthStatus | "unknown")
          : "unknown",
      penaltyScore: typeof entry.penaltyScore === "number" ? entry.penaltyScore : null,
      dominantFailureReason:
        entry.dominantFailureReason === "timeout" ||
        entry.dominantFailureReason === "handshake_failed" ||
        entry.dominantFailureReason === "connect_refused" ||
        entry.dominantFailureReason === "dns_blocked" ||
        entry.dominantFailureReason === "captive_portal" ||
        entry.dominantFailureReason === "packet_loss_suspected" ||
        entry.dominantFailureReason === "tls_error" ||
        entry.dominantFailureReason === "unknown"
          ? (entry.dominantFailureReason as TelemetryFailureReason)
          : null
    });
  }

  return candidates.filter((entry) => entry.endpointId.length > 0 && entry.transportProfile.length > 0);
}

export function mapRouteReprobeAttemptAudit(value: unknown): RouteReprobeJobAttemptAuditEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const audit: RouteReprobeJobAttemptAuditEntry[] = [];

  for (const entry of value) {
    if (!isRecord(entry)) {
      continue;
    }

    const event =
      entry.event === "queued" ||
      entry.event === "claimed" ||
      entry.event === "lease_reclaimed" ||
      entry.event === "retry_scheduled" ||
      entry.event === "completed" ||
      entry.event === "failed" ||
      entry.event === "dead_lettered"
        ? entry.event
        : null;

    if (!event) {
      continue;
    }

    audit.push({
      attempt: typeof entry.attempt === "number" ? Math.max(0, Math.trunc(entry.attempt)) : 0,
      event,
      at: typeof entry.at === "string" ? entry.at : new Date(0).toISOString(),
      workerId: typeof entry.workerId === "string" ? entry.workerId : null,
      message: typeof entry.message === "string" ? entry.message : null,
      nextAttemptAt: typeof entry.nextAttemptAt === "string" ? entry.nextAttemptAt : null
    });
  }

  return audit;
}

function clampMaxAttempts(value?: number) {
  if (!Number.isFinite(value)) {
    return defaultMaxAttempts;
  }

  return Math.min(Math.max(Math.trunc(value as number), 1), 10);
}

export function computeRouteReprobeBackoffMs(attempt: number) {
  const safeAttempt = Math.min(Math.max(Math.trunc(attempt), 1), 8);
  return Math.min(5 * 60 * 1000, 15_000 * 2 ** (safeAttempt - 1));
}

function appendAuditEntry(
  existing: unknown,
  entry: RouteReprobeJobAttemptAuditEntry
) {
  return asJson([...mapRouteReprobeAttemptAudit(existing), entry]);
}

function appendAuditEntries(
  existing: unknown,
  entries: RouteReprobeJobAttemptAuditEntry[]
) {
  return asJson([...mapRouteReprobeAttemptAudit(existing), ...entries]);
}

export function mapRouteReprobeJobSummary(job: RouteReprobeJob): RouteReprobeJobSummary {
  return {
    id: job.id,
    status: job.status as RouteReprobeJobStatus,
    createdAt: job.createdAt.toISOString(),
    startedAt: job.startedAt?.toISOString() ?? null,
    completedAt: job.completedAt?.toISOString() ?? null,
    context: mapContext(job.context),
    note: job.note,
    candidateLimit: job.candidateLimit,
    recommendedEndpointId: job.recommendedEndpointId,
    candidates: mapCandidates(job.candidates),
    recordedResultsCount: job.recordedResultsCount,
    failureMessage: job.failureMessage,
    attempts: job.attempts,
    maxAttempts: job.maxAttempts,
    nextAttemptAt: job.nextAttemptAt?.toISOString() ?? null,
    leaseExpiresAt: job.leaseExpiresAt?.toISOString() ?? null,
    leaseReclaimedCount: job.leaseReclaimedCount,
    deadLetteredAt: job.deadLetteredAt?.toISOString() ?? null,
    attemptAudit: mapRouteReprobeAttemptAudit(job.attemptAudit)
  };
}

function mapClaimedJob(job: RouteReprobeJob): ClaimedRouteReprobeJob {
  return {
    ...mapRouteReprobeJobSummary(job),
    appVersion: job.appVersion,
    results: mapResults(job.results),
    workerId: job.workerId
  };
}

export function createRouteReprobeJobStore(prisma: PrismaClient) {
  return {
    async enqueue(input: RouteReprobeJobBody & { candidateLimit: number }): Promise<RouteReprobeJobSummary> {
      const now = new Date();
      const maxAttempts = clampMaxAttempts(input.maxAttempts);
      const job = await prisma.routeReprobeJob.create({
        data: {
          id: randomUUID(),
          status: "queued",
          context: asJson({
            networkType: input.networkType,
            carrier: input.carrier,
            asn: input.asn,
            countryCode: input.countryCode,
            region: input.region
          }),
          note: input.note ?? null,
          appVersion: input.appVersion ?? null,
          candidateLimit: input.candidateLimit,
          maxAttempts,
          results: asJson(input.results ?? []),
          candidates: asJson([]),
          recommendedEndpointId: null,
          recordedResultsCount: 0,
          failureMessage: null,
          nextAttemptAt: now,
          attemptAudit: asJson([
            {
              attempt: 0,
              event: "queued",
              at: now.toISOString(),
              workerId: null,
              message: null,
              nextAttemptAt: now.toISOString()
            }
          ] satisfies RouteReprobeJobAttemptAuditEntry[])
        }
      });

      return mapRouteReprobeJobSummary(job);
    },

    async list(limit = 25): Promise<RouteReprobeJobSummary[]> {
      const jobs = await prisma.routeReprobeJob.findMany({
        orderBy: {
          createdAt: "desc"
        },
        take: limit
      });

      return jobs.map(mapRouteReprobeJobSummary);
    },

    async claimNext(input: { workerId: string; leaseMs: number }): Promise<ClaimedRouteReprobeJob | null> {
      const now = new Date();
      const leaseExpiresAt = new Date(now.getTime() + input.leaseMs);

      return prisma.$transaction(async (tx) => {
        const candidate = await tx.routeReprobeJob.findFirst({
          where: {
            OR: [
              {
                status: "queued",
                OR: [
                  { nextAttemptAt: null },
                  {
                    nextAttemptAt: {
                      lte: now
                    }
                  }
                ]
              },
              {
                status: "running",
                leaseExpiresAt: {
                  lt: now
                }
              }
            ]
          },
          orderBy: {
            createdAt: "asc"
          }
        });

        if (!candidate) {
          return null;
        }

        const reclaimingLease = candidate.status === "running";
        const nextAttemptCount = candidate.attempts + 1;

        const claimed = await tx.routeReprobeJob.updateMany({
          where: {
            id: candidate.id,
            OR: [
              {
                status: "queued",
                OR: [
                  { nextAttemptAt: null },
                  {
                    nextAttemptAt: {
                      lte: now
                    }
                  }
                ]
              },
              {
                status: "running",
                leaseExpiresAt: {
                  lt: now
                }
              }
            ]
          },
          data: {
            status: "running",
            workerId: input.workerId,
            startedAt: now,
            completedAt: null,
            deadLetteredAt: null,
            failureMessage: null,
            leaseExpiresAt,
            attempts: nextAttemptCount,
            leaseReclaimedCount: reclaimingLease ? candidate.leaseReclaimedCount + 1 : candidate.leaseReclaimedCount,
            attemptAudit: appendAuditEntry(
              reclaimingLease
                ? appendAuditEntry(candidate.attemptAudit, {
                    attempt: candidate.attempts,
                    event: "lease_reclaimed",
                    at: now.toISOString(),
                    workerId: candidate.workerId,
                    message: "Previous worker lease expired before completion",
                    nextAttemptAt: null
                  })
                : candidate.attemptAudit,
              {
                attempt: nextAttemptCount,
                event: "claimed",
                at: now.toISOString(),
                workerId: input.workerId,
                message: reclaimingLease ? "Job reclaimed after stale lease" : null,
                nextAttemptAt: null
              }
            )
          }
        });

        if (claimed.count === 0) {
          return null;
        }

        const job = await tx.routeReprobeJob.findUnique({
          where: {
            id: candidate.id
          }
        });

        return job ? mapClaimedJob(job) : null;
      });
    },

    async complete(input: {
      jobId: string;
      context: TelemetryNetworkContext;
      candidateLimit: number;
      recommendedEndpointId: string | null;
      candidates: RouteReprobeCandidateSummary[];
      recordedResultsCount: number;
    }): Promise<void> {
      const now = new Date();

      await prisma.$transaction(async (tx) => {
        const job = await tx.routeReprobeJob.findUnique({
          where: {
            id: input.jobId
          }
        });

        if (!job) {
          return;
        }

        await tx.routeReprobeJob.update({
          where: {
            id: input.jobId
          },
          data: {
            status: "completed",
            completedAt: now,
            leaseExpiresAt: null,
            workerId: null,
            nextAttemptAt: null,
            context: asJson(input.context),
            candidateLimit: input.candidateLimit,
            recommendedEndpointId: input.recommendedEndpointId,
            candidates: asJson(input.candidates),
            recordedResultsCount: input.recordedResultsCount,
            failureMessage: null,
            attemptAudit: appendAuditEntry(job.attemptAudit, {
              attempt: job.attempts,
              event: "completed",
              at: now.toISOString(),
              workerId: job.workerId,
              message: null,
              nextAttemptAt: null
            })
          }
        });
      });
    },

    async fail(input: { jobId: string; message: string }): Promise<void> {
      const now = new Date();

      await prisma.$transaction(async (tx) => {
        const job = await tx.routeReprobeJob.findUnique({
          where: {
            id: input.jobId
          }
        });

        if (!job) {
          return;
        }

        const shouldDeadLetter = job.attempts >= job.maxAttempts;
        const nextAttemptAt = shouldDeadLetter ? null : new Date(now.getTime() + computeRouteReprobeBackoffMs(job.attempts));
        const attemptAuditWithFailure = appendAuditEntries(job.attemptAudit, [
          {
            attempt: job.attempts,
            event: "failed",
            at: now.toISOString(),
            workerId: job.workerId,
            message: input.message,
            nextAttemptAt: null
          },
          {
            attempt: job.attempts,
            event: shouldDeadLetter ? "dead_lettered" : "retry_scheduled",
            at: now.toISOString(),
            workerId: job.workerId,
            message: input.message,
            nextAttemptAt: nextAttemptAt?.toISOString() ?? null
          }
        ]);

        await tx.routeReprobeJob.update({
          where: {
            id: input.jobId
          },
          data: {
            status: shouldDeadLetter ? "dead_letter" : "queued",
            completedAt: shouldDeadLetter ? now : null,
            deadLetteredAt: shouldDeadLetter ? now : null,
            leaseExpiresAt: null,
            workerId: null,
            failureMessage: input.message,
            nextAttemptAt,
            attemptAudit: attemptAuditWithFailure
          }
        });
      });
    }
  };
}

export type RouteReprobeJobStore = ReturnType<typeof createRouteReprobeJobStore>;
