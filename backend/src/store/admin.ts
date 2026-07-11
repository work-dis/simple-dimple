import type { PrismaClient } from "../generated/prisma/client.js";
import { SubscriptionStatus, UserStatus } from "../generated/prisma/client.js";
import type {
  AdminOpsSummary,
  AdminUserSummary,
  RouteDecisionOpsSummary
} from "../types.js";
import {
  StoreError,
  mapUserRowToAdminUserSummary
} from "./utils.js";
import { loadAdminUsers } from "./shared.js";
import { buildRouteDecisionOpsSummary } from "./route-decision-ops.js";

// --------------------------------------------------------------------------
// AdminStore
// --------------------------------------------------------------------------

export function createAdminStore(prisma: PrismaClient) {
  return {
    async listAdminUsers(): Promise<AdminUserSummary[]> {
      return loadAdminUsers(prisma);
    },

    async updateAdmin(input: {
      userId: string;
      isAdmin?: boolean;
      opsAlertImmediateEnabled?: boolean;
      opsAlertDigestEnabled?: boolean;
      opsAlertEscalationTier?: "primary" | "secondary";
    }): Promise<AdminUserSummary> {
      const user = await prisma.user.findUnique({
        where: { id: input.userId }
      });

      if (!user) {
        throw new StoreError("User not found", 404);
      }

      const updateData: Record<string, unknown> = {};

      if (input.isAdmin !== undefined) {
        if (input.isAdmin === false && user.isAdmin) {
          const adminCount = await prisma.user.count({ where: { isAdmin: true } });
          if (adminCount <= 1) {
            throw new StoreError("Cannot remove the last remaining admin", 409);
          }
        }
        updateData.isAdmin = input.isAdmin;
      }

      if (input.opsAlertImmediateEnabled !== undefined) {
        updateData.opsAlertImmediateEnabled = input.opsAlertImmediateEnabled;
      }

      if (input.opsAlertDigestEnabled !== undefined) {
        updateData.opsAlertDigestEnabled = input.opsAlertDigestEnabled;
      }

      if (input.opsAlertEscalationTier !== undefined) {
        updateData.opsAlertEscalationTier = input.opsAlertEscalationTier;
      }

      if (Object.keys(updateData).length > 0) {
        await prisma.user.update({
          where: { id: input.userId },
          data: updateData
        });
      }

      const updatedUser = await prisma.user.findUnique({
        where: { id: input.userId },
        include: {
          passwordCredential: true,
          authSessions: {
            orderBy: {
              lastAuthenticatedAt: "desc"
            },
            take: 1
          }
        }
      });

      if (!updatedUser) {
        throw new StoreError("Updated user not found", 500);
      }

      return mapUserRowToAdminUserSummary(updatedUser);
    },

    async getRouteDecisionOpsSummary(input: {
      windowHours?: number;
      recentLimit?: number;
      summaryLimit?: number;
    }): Promise<RouteDecisionOpsSummary> {
      const windowHours = Number.isFinite(input.windowHours) ? Math.max(1, Math.trunc(input.windowHours as number)) : 72;
      const recentLimit = Number.isFinite(input.recentLimit) ? Math.min(Math.max(Math.trunc(input.recentLimit as number), 1), 50) : 12;
      const summaryLimit = Number.isFinite(input.summaryLimit) ? Math.min(Math.max(Math.trunc(input.summaryLimit as number), 1), 20) : 6;
      const sinceDate = new Date(Date.now() - windowHours * 60 * 60 * 1000);

      const routeEvents = await prisma.routeEvent.findMany({
        where: {
          occurredAt: {
            gte: sinceDate
          }
        },
        orderBy: {
          occurredAt: "asc"
        },
        include: {
          endpoint: {
            select: {
              id: true,
              label: true,
              provider: true,
              asn: true,
              transportProfile: true,
              city: true,
              countryCode: true,
              serverPool: {
                select: {
                  region: true
                }
              }
            }
          },
          networkFingerprint: {
            select: {
              id: true,
              networkType: true,
              carrier: true,
              asn: true,
              countryCode: true,
              region: true
            }
          }
        }
      });
      const routeReprobeJobs = await prisma.routeReprobeJob.findMany({
        where: {
          createdAt: {
            gte: sinceDate
          }
        },
        orderBy: {
          createdAt: "asc"
        }
      });
      const endpointInventory = await prisma.endpoint.findMany({
        where: {
          isActive: true,
          serverPool: {
            isActive: true
          }
        },
        select: {
          id: true,
          provider: true,
          asn: true,
          countryCode: true,
          serverPool: {
            select: {
              code: true,
              region: true
            }
          }
        }
      });
      const poolClientSync = await prisma.serverPool.findMany({
        where: { isActive: true },
        select: {
          code: true,
          clientsSyncedAt: true
        }
      });
      return buildRouteDecisionOpsSummary({
        routeEvents,
        routeReprobeJobs,
        poolClientSync,
        endpointInventory: endpointInventory.map((endpoint) => ({
          endpointId: endpoint.id,
          provider: endpoint.provider,
          asn: endpoint.asn,
          poolCode: endpoint.serverPool.code,
          countryCode: endpoint.countryCode,
          region: endpoint.serverPool.region
        })),
        windowHours,
        recentLimit,
        summaryLimit
      });
    },

    async getOpsSummary(input: {
      includeProbeStats?: boolean;
      timeWindowMinutes?: number;
    }): Promise<AdminOpsSummary> {
      const timeWindowMinutes = input.timeWindowMinutes ?? 60;
      const sinceDate = new Date(Date.now() - timeWindowMinutes * 60 * 1000);

      const totalUsers = await prisma.user.count();
      const activeUsers = await prisma.user.count({
        where: { status: UserStatus.active }
      });
      const blockedUsers = await prisma.user.count({
        where: { status: UserStatus.blocked }
      });
      const activeSubscriptions = await prisma.subscription.count({
        where: { status: SubscriptionStatus.active }
      });
      // Connection-state (session status/activeServerId) is per-user — this
      // dashboard reports aggregate connection counts across all users
      // instead of one arbitrary "primary" session.
      const trackedSessions = await prisma.connectionState.count();
      const connectedSessions = await prisma.connectionState.count({
        where: { status: "connected" }
      });

      const summary: AdminOpsSummary = {
        users: {
          total: totalUsers,
          active: activeUsers,
          blocked: blockedUsers
        },
        subscriptions: {
          active: activeSubscriptions
        },
        connections: {
          tracked: trackedSessions,
          connected: connectedSessions
        },
        timeWindowMinutes,
        computedAt: new Date().toISOString()
      };

      if (input.includeProbeStats) {
        const totalProbes = await prisma.probeReport.count({
          where: {
            testedAt: {
              gte: sinceDate
            }
          }
        });
        const connectedProbes = await prisma.probeReport.count({
          where: {
            result: "connected",
            testedAt: {
              gte: sinceDate
            }
          }
        });
        const failedProbes = await prisma.probeReport.count({
          where: {
            result: "failed",
            testedAt: {
              gte: sinceDate
            }
          }
        });

        summary.probeStats = {
          total: totalProbes,
          connected: connectedProbes,
          failed: failedProbes,
          successRate: totalProbes > 0 ? Number(((connectedProbes / totalProbes) * 100).toFixed(1)) : 0
        };
      }

      return summary;
    }
  };
}
