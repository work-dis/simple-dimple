import { randomUUID } from "node:crypto";

import type { PrismaClient } from "../generated/prisma/client.js";
import { getInventoryPolicyViolation, summarizeInventoryHealth } from "../inventory-policy.js";
import type { InventoryPolicyRecord } from "../inventory-policy.js";
import type {
  AdminEndpointSummary,
  RegisterAdminEndpointBody,
  ShadowsocksClientSummary,
  TrojanClientSummary,
  VlessClientSummary
} from "../types.js";
import { StoreError } from "./utils.js";

// Шаг 5 (PRIORITY_PLAN.md) — fleet provisioning для Xray-нод: регистрация
// новой ноды и явный retire без ручной правки backend/src/defaults.ts и без
// редеплоя backend. Отдельный модуль от store/admin.ts (тот — про
// users/ops-summary, этот — про endpoint-инвентарь), тот же принцип
// разделения по доменам, что и остальной store/ (Decision 017).

type EndpointRowForSummary = {
  id: string;
  label: string;
  provider: string;
  asn: number | null;
  countryCode: string;
  city: string | null;
  ipAddress: string;
  protocol: string;
  transportProfile: string;
  latencyMs: number;
  loadPercent: number;
  isActive: boolean;
  lastHealthCheckAt: Date | null;
  lastHealthCheckOk: boolean | null;
  consecutiveHealthFailures: number;
  retiredAt: Date | null;
  retiredReason: string | null;
  createdAt: Date;
  serverPool: {
    code: string;
    region: string | null;
  };
  transportConfig: {
    port: number;
    sni: string;
    fingerprint: string;
    flow: string;
    shortId: string;
  } | null;
};

function mapEndpointRowToAdminSummary(row: EndpointRowForSummary): AdminEndpointSummary {
  return {
    id: row.id,
    label: row.label,
    provider: row.provider,
    asn: row.asn,
    countryCode: row.countryCode,
    city: row.city,
    poolCode: row.serverPool.code,
    region: row.serverPool.region,
    ipAddress: row.ipAddress,
    protocol: row.protocol,
    transportProfile: row.transportProfile,
    latencyMs: row.latencyMs,
    loadPercent: row.loadPercent,
    isActive: row.isActive,
    lastHealthCheckAt: row.lastHealthCheckAt ? row.lastHealthCheckAt.toISOString() : null,
    lastHealthCheckOk: row.lastHealthCheckOk,
    consecutiveHealthFailures: row.consecutiveHealthFailures,
    retiredAt: row.retiredAt ? row.retiredAt.toISOString() : null,
    retiredReason: row.retiredReason,
    transport: row.transportConfig
      ? {
          port: row.transportConfig.port,
          sni: row.transportConfig.sni,
          fingerprint: row.transportConfig.fingerprint,
          flow: row.transportConfig.flow,
          shortId: row.transportConfig.shortId
        }
      : null,
    createdAt: row.createdAt.toISOString()
  };
}

/**
 * Чистая функция, не трогает Prisma — можно тестировать без БД. Проверяет,
 * не уронит ли retire конкретного endpoint'а активный inventory ниже
 * policy-минимума (тот же MINIMUM_INDEPENDENT_FAILURE_DOMAINS инвариант,
 * который session.ts listServers() уже применяет fail-closed при чтении —
 * см. backend/src/inventory-policy.ts). Без этой проверки один неосторожный
 * retire мог бы положить session/resolve/connect/server для всех
 * пользователей разом.
 */
export function evaluateEndpointRetirement(
  activeEndpoints: InventoryPolicyRecord[],
  endpointIdToRetire: string
): { ok: true } | { ok: false; violationMessage: string } {
  const remaining = activeEndpoints.filter((endpoint) => endpoint.endpointId !== endpointIdToRetire);
  const violation = getInventoryPolicyViolation(summarizeInventoryHealth(remaining));

  if (violation) {
    return {
      ok: false,
      violationMessage: `Retiring this endpoint would break the active-inventory policy invariant. ${violation}`
    };
  }

  return { ok: true };
}

export function createEndpointsStore(prisma: PrismaClient) {
  const includeForSummary = {
    serverPool: { select: { code: true, region: true } },
    transportConfig: {
      select: { port: true, sni: true, fingerprint: true, flow: true, shortId: true }
    }
  } as const;

  return {
    async listAdminEndpoints(): Promise<AdminEndpointSummary[]> {
      const rows = await prisma.endpoint.findMany({
        include: includeForSummary,
        orderBy: [{ isActive: "desc" }, { createdAt: "desc" }]
      });

      return rows.map(mapEndpointRowToAdminSummary);
    },

    // Протокольная diversity (Decision 052): раньше эта функция умела
    // регистрировать только vless+REALITY endpoint'ы (жёсткая проверка
    // publicKey/shortId/sni). Теперь диспатчит по input.protocol и создаёт
    // соответствующий *TransportConfig — тем же паттерном одной Prisma
    // create-транзакции с nested create, что и раньше.
    async registerEndpoint(input: RegisterAdminEndpointBody): Promise<AdminEndpointSummary> {
      if (
        !input.label ||
        !input.ipAddress ||
        !input.provider ||
        !input.countryCode ||
        !input.poolCode ||
        !input.protocol ||
        !input.transportProfile ||
        !input.port
      ) {
        throw new StoreError(
          "label, ipAddress, provider, countryCode, poolCode, protocol, transportProfile and port are required",
          400
        );
      }

      if (input.protocol === "vless" && (!input.publicKey || !input.shortId || !input.sni)) {
        throw new StoreError("publicKey, shortId and sni are required for protocol=vless", 400);
      }
      if (input.protocol === "trojan" && !input.trojanSni) {
        throw new StoreError("trojanSni is required for protocol=trojan", 400);
      }
      if (input.protocol === "shadowsocks-2022" && !input.ssServerKey) {
        throw new StoreError("ssServerKey is required for protocol=shadowsocks-2022", 400);
      }
      if (input.protocol !== "vless" && input.protocol !== "trojan" && input.protocol !== "shadowsocks-2022") {
        throw new StoreError("protocol must be one of vless, trojan, shadowsocks-2022", 400);
      }

      const pool = await prisma.serverPool.upsert({
        where: { code: input.poolCode },
        update: {},
        create: {
          id: randomUUID(),
          code: input.poolCode,
          provider: input.provider,
          asn: input.asn ?? null,
          countryCode: input.countryCode,
          region: input.region ?? null,
          priority: input.priority ?? 50
        }
      });

      const endpoint = await prisma.endpoint.create({
        data: {
          id: randomUUID(),
          serverPoolId: pool.id,
          label: input.label,
          ipAddress: input.ipAddress,
          provider: input.provider,
          asn: input.asn ?? null,
          countryCode: input.countryCode,
          city: input.city ?? null,
          transportProfile: input.transportProfile,
          protocol: input.protocol,
          latencyMs: input.latencyMs ?? 50,
          loadPercent: input.loadPercent ?? 0,
          isActive: true,
          transportConfig:
            input.protocol === "vless"
              ? {
                  create: {
                    id: randomUUID(),
                    port: input.port,
                    publicKey: input.publicKey!,
                    shortId: input.shortId!,
                    sni: input.sni!,
                    fingerprint: input.fingerprint ?? "chrome",
                    flow: input.flow ?? "xtls-rprx-vision"
                  }
                }
              : undefined,
          trojanTransportConfig:
            input.protocol === "trojan"
              ? {
                  create: {
                    id: randomUUID(),
                    port: input.port,
                    sni: input.trojanSni!,
                    fingerprint: input.trojanFingerprint ?? "chrome",
                    alpn: input.trojanAlpn ?? "h2,http/1.1",
                    certSha256: input.trojanCertSha256 ?? null
                  }
                }
              : undefined,
          shadowsocksTransportConfig:
            input.protocol === "shadowsocks-2022"
              ? {
                  create: {
                    id: randomUUID(),
                    port: input.port,
                    method: input.ssMethod ?? "2022-blake3-aes-256-gcm",
                    serverKey: input.ssServerKey!
                  }
                }
              : undefined
        },
        include: includeForSummary
      });

      return mapEndpointRowToAdminSummary(endpoint);
    },

    async setEndpointActive(
      endpointId: string,
      isActive: boolean,
      retiredReason?: string
    ): Promise<AdminEndpointSummary> {
      const existing = await prisma.endpoint.findUnique({
        where: { id: endpointId },
        include: includeForSummary
      });

      if (!existing) {
        throw new StoreError("Endpoint not found", 404);
      }

      if (!isActive && existing.isActive) {
        const activeRows = await prisma.endpoint.findMany({
          where: { isActive: true, serverPool: { isActive: true } },
          select: {
            id: true,
            provider: true,
            asn: true,
            countryCode: true,
            serverPool: { select: { code: true, region: true } }
          }
        });
        const activeRecords: InventoryPolicyRecord[] = activeRows.map((row) => ({
          endpointId: row.id,
          provider: row.provider,
          asn: row.asn,
          poolCode: row.serverPool.code,
          countryCode: row.countryCode,
          region: row.serverPool.region
        }));

        const evaluation = evaluateEndpointRetirement(activeRecords, endpointId);
        if (!evaluation.ok) {
          throw new StoreError(evaluation.violationMessage, 409);
        }
      }

      const updated = await prisma.endpoint.update({
        where: { id: endpointId },
        data: {
          isActive,
          // Ручная реактивация — чистый лист по health-счётчику, тот же
          // сброс, что healthcheck worker делает на успешный пинг
          // (store/endpoint-healthcheck.ts).
          consecutiveHealthFailures: isActive ? 0 : existing.consecutiveHealthFailures,
          // Аудит retire: это всегда "manual" (или явный reason из вызова),
          // в отличие от healthcheck-воркера, который сам ставит
          // "auto_health_failure" — Ops должен отличать осознанный вывод
          // ноды от временного сбоя (store/endpoint-healthcheck.ts).
          retiredAt: isActive ? null : new Date(),
          retiredReason: isActive ? null : retiredReason ?? "manual"
        },
        include: includeForSummary
      });

      return mapEndpointRowToAdminSummary(updated);
    },

    // Шаг 2 (PRIORITY_PLAN.md) — известный пробел "per-user client id":
    // каждый Xray-инбаунд провижинится с одним сгенерированным client id
    // (deploy/xray/provision-node.sh), но connection-config.ts выдаёт
    // каждому пользователю персональный vlessUuid. Источник правды для
    // deploy/xray/sync-clients.sh, который на каждой ноде периодически
    // перекладывает актуальный список в inbound.settings.clients.
    async listVlessClients(): Promise<VlessClientSummary[]> {
      const users = await prisma.user.findMany({
        where: { vlessUuid: { not: null } },
        select: { vlessUuid: true }
      });

      return users.map((user) => ({
        uuid: user.vlessUuid!,
        flow: "xtls-rprx-vision"
      }));
    },

    // Протокольная diversity (Decision 052) — тот же паттерн, что
    // listVlessClients выше, для User.trojanPassword.
    async listTrojanClients(): Promise<TrojanClientSummary[]> {
      const users = await prisma.user.findMany({
        where: { trojanPassword: { not: null } },
        select: { trojanPassword: true }
      });

      return users.map((user) => ({ password: user.trojanPassword! }));
    },

    // Per-user PSK (User.shadowsocksUserKey). Итоговый ключ клиента —
    // "serverKey:userKey" (см. connection-config.ts) — server-side xray
    // combines the shared serverKey (inbound settings.password) with each
    // client's individual password, поэтому здесь передаём только userKey.
    async listShadowsocksClients(): Promise<ShadowsocksClientSummary[]> {
      const users = await prisma.user.findMany({
        where: { shadowsocksUserKey: { not: null } },
        select: { shadowsocksUserKey: true }
      });

      return users.map((user) => ({ password: user.shadowsocksUserKey! }));
    },

    // Хартбит client-list синка: sync-clients.sh передаёт ?pool=<code> при
    // каждом чтении /api/admin/vless-clients. Неизвестный код пула — не
    // ошибка (нода может быть запровижена раньше, чем зарегистрирована в
    // инвентаре), просто нечего отмечать.
    async recordPoolClientsSync(poolCode: string): Promise<boolean> {
      const result = await prisma.serverPool.updateMany({
        where: { code: poolCode },
        data: { clientsSyncedAt: new Date() }
      });

      return result.count > 0;
    }
  };
}
