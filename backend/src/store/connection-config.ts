import { randomBytes, randomUUID } from "node:crypto";

import type { PrismaClient } from "../generated/prisma/client.js";
import {
  buildShadowsocksConnectionConfig,
  buildTrojanConnectionConfig,
  buildVlessRealityConnectionConfig
} from "../connection-config.js";
import type { AuthSessionSummary, ConnectionConfigSummary } from "../types.js";

// Per-user секрет для Shadowsocks-2022 (User.shadowsocksUserKey) — base64
// PSK того же формата, что и серверный ключ (see EndpointProvisioning),
// 32 случайных байта, аналогично тому, как vlessUuid генерируется лениво
// при первой выдаче конфига, а не заранее.
function generateShadowsocksUserKey(): string {
  return randomBytes(32).toString("base64");
}

// Per-user пароль для Trojan — просто случайный секрет, как и vlessUuid;
// формат пароля в Trojan произвольный (в отличие от VLESS, не обязан быть
// UUID), поэтому берём urlsafe base64, а не UUID.
function generateTrojanPassword(): string {
  return randomBytes(24).toString("base64url");
}

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
        include: { transportConfig: true, trojanTransportConfig: true, shadowsocksTransportConfig: true }
      });

      if (!endpoint) {
        return null;
      }

      if (endpoint.protocol === "vless") {
        if (!endpoint.transportConfig) {
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

      if (endpoint.protocol === "trojan") {
        if (!endpoint.trojanTransportConfig) {
          return null;
        }

        const user = await prisma.user.findUnique({
          where: { id: auth.userId },
          select: { trojanPassword: true }
        });

        if (!user) {
          return null;
        }

        const password =
          user.trojanPassword ??
          (
            await prisma.user.update({
              where: { id: auth.userId },
              data: { trojanPassword: generateTrojanPassword() },
              select: { trojanPassword: true }
            })
          ).trojanPassword!;

        return buildTrojanConnectionConfig({
          endpointId: endpoint.id,
          password,
          label: endpoint.label,
          transport: {
            ipAddress: endpoint.ipAddress,
            port: endpoint.trojanTransportConfig.port,
            sni: endpoint.trojanTransportConfig.sni,
            fingerprint: endpoint.trojanTransportConfig.fingerprint,
            alpn: endpoint.trojanTransportConfig.alpn,
            certSha256: endpoint.trojanTransportConfig.certSha256
          }
        });
      }

      if (endpoint.protocol === "shadowsocks-2022") {
        if (!endpoint.shadowsocksTransportConfig) {
          return null;
        }

        const user = await prisma.user.findUnique({
          where: { id: auth.userId },
          select: { shadowsocksUserKey: true }
        });

        if (!user) {
          return null;
        }

        const userKey =
          user.shadowsocksUserKey ??
          (
            await prisma.user.update({
              where: { id: auth.userId },
              data: { shadowsocksUserKey: generateShadowsocksUserKey() },
              select: { shadowsocksUserKey: true }
            })
          ).shadowsocksUserKey!;

        return buildShadowsocksConnectionConfig({
          endpointId: endpoint.id,
          serverKey: endpoint.shadowsocksTransportConfig.serverKey,
          userKey,
          label: endpoint.label,
          transport: {
            ipAddress: endpoint.ipAddress,
            port: endpoint.shadowsocksTransportConfig.port,
            method: endpoint.shadowsocksTransportConfig.method
          }
        });
      }

      return null;
    }
  };
}
