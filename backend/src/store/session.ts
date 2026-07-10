import { randomUUID } from "node:crypto";

import type { PrismaClient } from "../generated/prisma/client.js";
import { ContactType } from "../generated/prisma/client.js";
import { getInventoryPolicyViolation, summarizeInventoryHealth } from "../inventory-policy.js";
import { selectClientSegment } from "../inventory-segmentation.js";
import type {
  AuthSessionSummary,
  EndpointAssignmentSummary,
  LastKnownGoodRouteSummary,
  ServerOption,
  ServerSegmentationContext,
  SessionState,
  TelemetryNetworkContext,
  UserProfile
} from "../types.js";
import {
  StoreError,
  normalizeSession,
  mapEndpointRowToServerOption,
  mapAssignmentRowToSummary,
  mapLastKnownGoodRouteRowToSummary,
  cloneDefaultState
} from "./utils.js";
import {
  findBestAvailableRankingFingerprintId,
  findCurrentDeviceId,
  resolveNetworkFingerprintId
} from "./shared.js";

// --------------------------------------------------------------------------
// SessionStore
// --------------------------------------------------------------------------

export function createSessionStore(prisma: PrismaClient) {
  return {
    async readConnectionState(userId: string): Promise<SessionState> {
      const fallbackState = cloneDefaultState();
      const sessionRow = await prisma.connectionState.findUnique({ where: { userId } });

      if (!sessionRow) {
        return fallbackState;
      }

      // activeServerId живёт во флоте, который теперь администрируется
      // динамически (/api/admin/endpoints) — сверяем с БД, а не со
      // статическим serverOptions из defaults.ts, иначе рестарт backend
      // молча сбрасывает активный динамически зарегистрированный сервер.
      const activeEndpoint = await prisma.endpoint.findUnique({
        where: { id: sessionRow.activeServerId },
        select: { id: true, isActive: true }
      });

      return {
        status: normalizeSession({ status: sessionRow.status as SessionState["status"] }).status,
        activeServerId: activeEndpoint?.isActive ? sessionRow.activeServerId : fallbackState.activeServerId,
        updatedAt: sessionRow.updatedAt.toISOString(),
        connectCount: sessionRow.connectCount
      };
    },

    async listServers(
      context?: TelemetryNetworkContext,
      segmentation?: ServerSegmentationContext
    ): Promise<ServerOption[]> {
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
      const inventoryHealth = summarizeInventoryHealth(
        serverOptions.map((server) => ({
          endpointId: server.id,
          provider: server.provider,
          asn: server.asn,
          poolCode: server.poolCode,
          countryCode: server.countryCode,
          region: server.region
        }))
      );
      const inventoryPolicyViolation = getInventoryPolicyViolation(inventoryHealth);

      if (inventoryPolicyViolation) {
        throw new StoreError(`Active server inventory is not policy-compliant. ${inventoryPolicyViolation}`, 503);
      }

      // Bridge-модель (Decision 024): policy-проверка выше всегда идёт по
      // ПОЛНОМУ inventory — доступность/diversity инвариант не должен зависеть
      // от того, попадает ли конкретный клиент в сегментацию. Сегментация —
      // это только про то, что видит конкретный клиент, а не про то, что
      // вообще доступно системе.
      const visibleOptions = segmentation
        ? selectClientSegment(serverOptions, segmentation.subjectId, Date.now(), undefined, segmentation.pinnedEndpointIds)
        : serverOptions;

      if (!context) {
        return visibleOptions;
      }

      const rankingFingerprintId = await findBestAvailableRankingFingerprintId(prisma, context);

      if (!rankingFingerprintId) {
        return visibleOptions;
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
        return visibleOptions;
      }

      const rankingMap = new Map(rankings.map((ranking) => [ranking.endpointId, ranking.rankPosition]));

      return [...visibleOptions].sort((left, right) => {
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
        throw new StoreError("Endpoint not found", 404);
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
        throw new StoreError("Endpoint not found", 404);
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

    async writeSession(userId: string, session: SessionState): Promise<void> {
      await prisma.connectionState.upsert({
        where: { userId },
        update: {
          status: session.status,
          activeServerId: session.activeServerId,
          updatedAt: new Date(session.updatedAt),
          connectCount: session.connectCount
        },
        create: {
          userId,
          status: session.status,
          activeServerId: session.activeServerId,
          updatedAt: new Date(session.updatedAt),
          connectCount: session.connectCount
        }
      });
    },

    // Аккаунт (user/subscription/devices/authSession) в этой точке уже
    // существует в БД — сюда попадают только по авторизованной сессии.
    // Полный upsert всего PersistedState (как раньше делал writeState)
    // был избыточен ради обновления трёх полей профиля.
    async updateAccountProfile(
      userId: string,
      patch: Pick<UserProfile, "displayName" | "contact" | "contactType">
    ): Promise<void> {
      await prisma.user.update({
        where: { id: userId },
        data: {
          displayName: patch.displayName,
          contact: patch.contact,
          contactType: patch.contactType === "telegram" ? ContactType.telegram : ContactType.email
        }
      });
    }
  };
}
