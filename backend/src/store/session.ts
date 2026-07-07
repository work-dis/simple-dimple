import { randomUUID } from "node:crypto";

import type { PrismaClient } from "../generated/prisma/client.js";
import { ContactType, AuthProvider, AuthSessionStatus, SubscriptionStatus, UserStatus } from "../generated/prisma/client.js";
import type {
  AuthSessionSummary,
  EndpointAssignmentSummary,
  LastKnownGoodRouteSummary,
  PersistedState,
  ServerOption,
  SessionState,
  TelemetryNetworkContext
} from "../types.js";
import {
  StoreAuthError,
  normalizeSession,
  normalizeAccount,
  normalizeAuthSession,
  mapEndpointRowToServerOption,
  mapAssignmentRowToSummary,
  mapLastKnownGoodRouteRowToSummary,
  mapAuthSessionRow,
  cloneDefaultState,
  cloneDefaultAccount,
  cloneDefaultAuthSession,
  isValidServerId
} from "./utils.js";
import {
  findBestAvailableRankingFingerprintId,
  loadUserAccountById,
  findCurrentDeviceId,
  resolveNetworkFingerprintId
} from "./shared.js";

// --------------------------------------------------------------------------
// SessionStore
// --------------------------------------------------------------------------

export function createSessionStore(prisma: PrismaClient) {
  return {
    async readState(): Promise<PersistedState> {
      const fallbackState = cloneDefaultState();
      const fallbackAuth = cloneDefaultAuthSession();

      const [sessionRow, authSessionRow] = await Promise.all([
        prisma.appSession.findUnique({ where: { id: "primary" } }),
        prisma.authSession.findFirst({
          where: {
            status: "active"
          },
          orderBy: {
            lastAuthenticatedAt: {
              sort: "desc",
              nulls: "last"
            }
          }
        })
      ]);

      const nextAuth = mapAuthSessionRow(authSessionRow);
      const account = nextAuth.isAuthenticated && nextAuth.userId
        ? await loadUserAccountById(prisma, nextAuth.userId)
        : cloneDefaultAccount();

      return {
        auth: nextAuth,
        session: sessionRow
          ? {
              status: normalizeSession({ status: sessionRow.status as SessionState["status"] }).status,
              activeServerId: isValidServerId(sessionRow.activeServerId)
                ? sessionRow.activeServerId
                : fallbackState.activeServerId,
              updatedAt: sessionRow.updatedAt.toISOString(),
              connectCount: sessionRow.connectCount
            }
          : fallbackState,
        account
      };
    },

    async listServers(context?: TelemetryNetworkContext): Promise<ServerOption[]> {
      const endpointRows = await prisma.endpoint.findMany({
        where: {
          isActive: true,
          serverPool: {
            isActive: true
          }
        },
        include: {
          serverPool: {
            select: {
              code: true,
              region: true,
              priority: true
            }
          }
        },
        orderBy: [
          {
            serverPool: {
              priority: "asc"
            }
          },
          {
            latencyMs: "asc"
          }
        ]
      });
      const serverOptions = endpointRows.map((endpointRow) => mapEndpointRowToServerOption(endpointRow));

      if (!context) {
        return serverOptions;
      }

      const rankingFingerprintId = await findBestAvailableRankingFingerprintId(prisma, context);

      if (!rankingFingerprintId) {
        return serverOptions;
      }

      const rankings = await prisma.routeRanking.findMany({
        where: {
          networkFingerprintId: rankingFingerprintId,
          expiresAt: {
            gt: new Date()
          }
        },
        orderBy: {
          rankPosition: "asc"
        },
        select: {
          endpointId: true,
          rankPosition: true
        }
      });

      if (rankings.length === 0) {
        return serverOptions;
      }

      const rankingMap = new Map(rankings.map((ranking) => [ranking.endpointId, ranking.rankPosition]));

      return [...serverOptions].sort((left, right) => {
        const leftRank = rankingMap.get(left.id) ?? Number.MAX_SAFE_INTEGER;
        const rightRank = rankingMap.get(right.id) ?? Number.MAX_SAFE_INTEGER;

        if (leftRank !== rightRank) {
          return leftRank - rightRank;
        }

        return left.latencyMs - right.latencyMs;
      });
    },

    async getCurrentAssignment(auth: AuthSessionSummary): Promise<EndpointAssignmentSummary | null> {
      if (!auth.userId) {
        return null;
      }

      const currentAssignment = await prisma.userEndpointAssignment.findFirst({
        where: {
          userId: auth.userId,
          OR: [
            {
              expiresAt: null
            },
            {
              expiresAt: {
                gt: new Date()
              }
            }
          ]
        },
        orderBy: {
          assignedAt: "desc"
        }
      });

      return currentAssignment ? mapAssignmentRowToSummary(currentAssignment) : null;
    },

    async getLastKnownGoodRoute(
      auth: AuthSessionSummary,
      context?: TelemetryNetworkContext
    ): Promise<LastKnownGoodRouteSummary | null> {
      if (!auth.userId) {
        return null;
      }

      const networkFingerprintId = context ? await resolveNetworkFingerprintId(prisma, context) : null;
      const exactMatch = networkFingerprintId
        ? await prisma.lastKnownGoodRoute.findFirst({
            where: {
              userId: auth.userId,
              networkFingerprintId,
              OR: [
                {
                  expiresAt: null
                },
                {
                  expiresAt: {
                    gt: new Date()
                  }
                }
              ],
              endpoint: {
                isActive: true
              }
            },
            orderBy: {
              lastSucceededAt: "desc"
            }
          })
        : null;

      if (exactMatch) {
        return mapLastKnownGoodRouteRowToSummary(exactMatch);
      }

      if (context) {
        const fallbackWithoutFingerprint = await prisma.lastKnownGoodRoute.findFirst({
          where: {
            userId: auth.userId,
            networkFingerprintId: null,
            OR: [
              {
                expiresAt: null
              },
              {
                expiresAt: {
                  gt: new Date()
                }
              }
            ],
            endpoint: {
              isActive: true
            }
          },
          orderBy: {
            lastSucceededAt: "desc"
          }
        });

        return fallbackWithoutFingerprint ? mapLastKnownGoodRouteRowToSummary(fallbackWithoutFingerprint) : null;
      }

      const latestRoute = await prisma.lastKnownGoodRoute.findFirst({
        where: {
          userId: auth.userId,
          OR: [
            {
              expiresAt: null
            },
            {
              expiresAt: {
                gt: new Date()
              }
            }
          ],
          endpoint: {
            isActive: true
          }
        },
        orderBy: {
          lastSucceededAt: "desc"
        }
      });

      return latestRoute ? mapLastKnownGoodRouteRowToSummary(latestRoute) : null;
    },

    async assignEndpoint(
      auth: AuthSessionSummary,
      input: { endpointId: string; assignmentReason: string; expiresAt?: string | null }
    ): Promise<EndpointAssignmentSummary | null> {
      if (!auth.userId) {
        return null;
      }

      const endpoint = await prisma.endpoint.findUnique({
        where: {
          id: input.endpointId
        },
        select: {
          id: true,
          isActive: true
        }
      });

      if (!endpoint || !endpoint.isActive) {
        throw new StoreAuthError("Endpoint not found", 404);
      }

      const deviceId = await findCurrentDeviceId(prisma, auth.userId);
      const assignment = await prisma.userEndpointAssignment.create({
        data: {
          id: randomUUID(),
          userId: auth.userId,
          deviceId,
          endpointId: endpoint.id,
          assignmentReason: input.assignmentReason,
          assignedAt: new Date(),
          expiresAt: input.expiresAt ? new Date(input.expiresAt) : null
        }
      });

      return mapAssignmentRowToSummary(assignment);
    },

    async recordLastKnownGoodRoute(
      auth: AuthSessionSummary,
      input: {
        endpointId: string;
        context?: TelemetryNetworkContext;
        sourceAssignmentReason?: string | null;
        expiresAt?: string | null;
      }
    ): Promise<LastKnownGoodRouteSummary | null> {
      if (!auth.userId) {
        return null;
      }

      const endpoint = await prisma.endpoint.findUnique({
        where: {
          id: input.endpointId
        },
        select: {
          id: true,
          isActive: true
        }
      });

      if (!endpoint || !endpoint.isActive) {
        throw new StoreAuthError("Endpoint not found", 404);
      }

      const [deviceId, networkFingerprintId] = await Promise.all([
        findCurrentDeviceId(prisma, auth.userId),
        resolveNetworkFingerprintId(prisma, input.context)
      ]);

      const route = await prisma.lastKnownGoodRoute.create({
        data: {
          id: randomUUID(),
          userId: auth.userId,
          deviceId,
          networkFingerprintId,
          endpointId: endpoint.id,
          sourceAssignmentReason: input.sourceAssignmentReason ?? null,
          lastSucceededAt: new Date(),
          expiresAt: input.expiresAt ? new Date(input.expiresAt) : null
        }
      });

      return mapLastKnownGoodRouteRowToSummary(route);
    },

    async writeSession(session: SessionState): Promise<void> {
      await prisma.appSession.upsert({
        where: { id: "primary" },
        update: {
          status: session.status,
          activeServerId: session.activeServerId,
          updatedAt: new Date(session.updatedAt),
          connectCount: session.connectCount
        },
        create: {
          id: "primary",
          status: session.status,
          activeServerId: session.activeServerId,
          updatedAt: new Date(session.updatedAt),
          connectCount: session.connectCount
        }
      });
    },

    async writeState(state: PersistedState): Promise<void> {
      await prisma.$transaction([
        prisma.appSession.upsert({
          where: { id: "primary" },
          update: {
            status: state.session.status,
            activeServerId: state.session.activeServerId,
            updatedAt: new Date(state.session.updatedAt),
            connectCount: state.session.connectCount
          },
          create: {
            id: "primary",
            status: state.session.status,
            activeServerId: state.session.activeServerId,
            updatedAt: new Date(state.session.updatedAt),
            connectCount: state.session.connectCount
          }
        }),
        prisma.user.upsert({
          where: { id: state.account.user.id },
          update: {
            displayName: state.account.user.displayName,
            contact: state.account.user.contact,
            contactType:
              state.account.user.contactType === "telegram" ? ContactType.telegram : ContactType.email,
            isAdmin: state.account.user.isAdmin,
            status:
              state.account.user.status === "active"
                ? UserStatus.active
                : state.account.user.status === "blocked"
                  ? UserStatus.blocked
                  : UserStatus.trial,
            memberSince: new Date(state.account.user.memberSince)
          },
          create: {
            id: state.account.user.id,
            displayName: state.account.user.displayName,
            contact: state.account.user.contact,
            contactType:
              state.account.user.contactType === "telegram" ? ContactType.telegram : ContactType.email,
            isAdmin: state.account.user.isAdmin,
            status:
              state.account.user.status === "active"
                ? UserStatus.active
                : state.account.user.status === "blocked"
                  ? UserStatus.blocked
                  : UserStatus.trial,
            memberSince: new Date(state.account.user.memberSince)
          }
        })
      ]);

      if (state.auth.userId) {
        await prisma.authSession.upsert({
          where: { id: state.auth.id },
          update: {
            userId: state.auth.userId,
            provider:
              state.auth.provider === "telegram"
                ? AuthProvider.telegram
                : state.auth.provider === "email"
                  ? AuthProvider.email
                  : AuthProvider.credentials,
            status:
              state.auth.status === "active"
                ? AuthSessionStatus.active
                : state.auth.status === "expired"
                  ? AuthSessionStatus.expired
                  : AuthSessionStatus.revoked,
            lastAuthenticatedAt: state.auth.lastAuthenticatedAt ? new Date(state.auth.lastAuthenticatedAt) : null,
            expiresAt: state.auth.expiresAt ? new Date(state.auth.expiresAt) : null,
            revokedAt: state.auth.status === "revoked" ? new Date() : null
          },
          create: {
            id: state.auth.id,
            userId: state.auth.userId,
            provider:
              state.auth.provider === "telegram"
                ? AuthProvider.telegram
                : state.auth.provider === "email"
                  ? AuthProvider.email
                  : AuthProvider.credentials,
            status:
              state.auth.status === "active"
                ? AuthSessionStatus.active
                : state.auth.status === "expired"
                  ? AuthSessionStatus.expired
                  : AuthSessionStatus.revoked,
            lastAuthenticatedAt: state.auth.lastAuthenticatedAt ? new Date(state.auth.lastAuthenticatedAt) : null,
            expiresAt: state.auth.expiresAt ? new Date(state.auth.expiresAt) : null,
            revokedAt: state.auth.status === "revoked" ? new Date() : null
          }
        });
      } else {
        await prisma.authSession.upsert({
          where: { id: state.auth.id },
          update: {
            userId: null,
            provider: AuthProvider.credentials,
            status: AuthSessionStatus.revoked,
            lastAuthenticatedAt: state.auth.lastAuthenticatedAt ? new Date(state.auth.lastAuthenticatedAt) : null,
            expiresAt: null,
            revokedAt: new Date()
          },
          create: {
            id: state.auth.id,
            userId: null,
            provider: AuthProvider.credentials,
            status: AuthSessionStatus.revoked,
            lastAuthenticatedAt: state.auth.lastAuthenticatedAt ? new Date(state.auth.lastAuthenticatedAt) : null,
            expiresAt: null,
            revokedAt: new Date()
          }
        });
      }

      await prisma.subscription.upsert({
        where: { userId: state.account.user.id },
        update: {
          plan: state.account.subscription.plan,
          renewalDate: new Date(state.account.subscription.renewalDate),
          status:
            state.account.subscription.status === "active"
              ? SubscriptionStatus.active
              : SubscriptionStatus.grace,
          autoRenew: state.account.subscription.autoRenew
        },
        create: {
          id: `${state.account.user.id}-subscription`,
          userId: state.account.user.id,
          plan: state.account.subscription.plan,
          renewalDate: new Date(state.account.subscription.renewalDate),
          status:
            state.account.subscription.status === "active"
              ? SubscriptionStatus.active
              : SubscriptionStatus.grace,
          autoRenew: state.account.subscription.autoRenew
        }
      });

      await prisma.device.deleteMany({
        where: {
          userId: state.account.user.id
        }
      });

      if (state.account.devices.length > 0) {
        await prisma.device.createMany({
          data: state.account.devices.map((device) => ({
            id: device.id,
            userId: state.account.user.id,
            name: device.name,
            platform: device.platform,
            lastSeenAt: new Date(device.lastSeenAt),
            isCurrent: device.isCurrent
          }))
        });
      }
    }
  };
}
