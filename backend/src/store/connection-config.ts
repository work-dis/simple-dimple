import { randomUUID } from "node:crypto";

import type { PrismaClient } from "../generated/prisma/client.js";
import { buildVlessRealityConnectionConfig } from "../connection-config.js";
import type { AuthSessionSummary, ConnectionConfigSummary } from "../types.js";

export function createConnectionConfigStore(prisma: PrismaClient) {
  return {
    async issueConnectionConfig(
      auth: AuthSessionSummary,
      endpointId: string | null
    ): Promise<ConnectionConfigSummary | null> {
      if (!auth.userId || !endpointId) {
        return null;
      }

      const endpoint = await prisma.endpoint.findUnique({
        where: { id: endpointId },
        include: { transportConfig: true }
      });

      if (!endpoint || !endpoint.transportConfig || endpoint.protocol !== "vless") {
        return null;
      }

      const user = await prisma.user.findUnique({
        where: { id: auth.userId },
        select: { vlessUuid: true }
      });

      if (!user) {
        return null;
      }

      const clientUuid =
        user.vlessUuid ??
        (
          await prisma.user.update({
            where: { id: auth.userId },
            data: { vlessUuid: randomUUID() },
            select: { vlessUuid: true }
          })
        ).vlessUuid!;

      return buildVlessRealityConnectionConfig({
        endpointId: endpoint.id,
        clientUuid,
        label: endpoint.label,
        transport: {
          ipAddress: endpoint.ipAddress,
          port: endpoint.transportConfig.port,
          publicKey: endpoint.transportConfig.publicKey,
          shortId: endpoint.transportConfig.shortId,
          sni: endpoint.transportConfig.sni,
          fingerprint: endpoint.transportConfig.fingerprint,
          flow: endpoint.transportConfig.flow
        }
      });
    }
  };
}
