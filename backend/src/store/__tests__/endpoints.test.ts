import { describe, expect, it } from "vitest";

import { createEndpointsStore, evaluateEndpointRetirement } from "../endpoints.js";
import type { InventoryPolicyRecord } from "../../inventory-policy.js";

function createRecord(overrides: Partial<InventoryPolicyRecord> & Pick<InventoryPolicyRecord, "endpointId">): InventoryPolicyRecord {
  return {
    endpointId: overrides.endpointId,
    provider: overrides.provider ?? "Hetzner",
    asn: overrides.asn ?? 24940,
    poolCode: overrides.poolCode ?? "fra-a",
    countryCode: overrides.countryCode ?? "DE",
    region: overrides.region ?? "Germany"
  };
}

describe("evaluateEndpointRetirement", () => {
  it("allows retiring an endpoint when 2+ independent failure domains remain", () => {
    const endpoints: InventoryPolicyRecord[] = [
      createRecord({ endpointId: "ep-1", provider: "Hetzner", asn: 24940, poolCode: "fra-a", countryCode: "DE", region: "Germany" }),
      createRecord({ endpointId: "ep-2", provider: "Leaseweb", asn: 16265, poolCode: "ams-b", countryCode: "NL", region: "Netherlands" }),
      createRecord({ endpointId: "ep-3", provider: "OVH", asn: 16276, poolCode: "waw-c", countryCode: "PL", region: "Poland" })
    ];

    const result = evaluateEndpointRetirement(endpoints, "ep-3");

    expect(result).toEqual({ ok: true });
  });

  it("blocks retiring an endpoint when it would drop below the minimum independent failure domains", () => {
    const endpoints: InventoryPolicyRecord[] = [
      createRecord({ endpointId: "ep-1", provider: "Hetzner", asn: 24940, poolCode: "fra-a", countryCode: "DE", region: "Germany" }),
      createRecord({ endpointId: "ep-2", provider: "Leaseweb", asn: 16265, poolCode: "ams-b", countryCode: "NL", region: "Netherlands" })
    ];

    const result = evaluateEndpointRetirement(endpoints, "ep-2");

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.violationMessage).toContain("active-inventory policy invariant");
  });

  it("is a no-op check when retiring an endpoint that is not in the active list", () => {
    const endpoints: InventoryPolicyRecord[] = [
      createRecord({ endpointId: "ep-1", provider: "Hetzner", asn: 24940, poolCode: "fra-a", countryCode: "DE", region: "Germany" }),
      createRecord({ endpointId: "ep-2", provider: "Leaseweb", asn: 16265, poolCode: "ams-b", countryCode: "NL", region: "Netherlands" }),
      createRecord({ endpointId: "ep-3", provider: "OVH", asn: 16276, poolCode: "waw-c", countryCode: "PL", region: "Poland" })
    ];

    // Уже неактивный/не найденный endpoint — фильтр по id ничего не уберёт,
    // остаток тот же самый список, всё ещё удовлетворяющий policy.
    const result = evaluateEndpointRetirement(endpoints, "ep-does-not-exist");

    expect(result).toEqual({ ok: true });
  });
});

// Шаг 5 (PRIORITY_PLAN.md) — retire-аудит: различаем "администратор явно
// вывел ноду" от того, что делает healthcheck-воркер (endpoint-healthcheck.ts),
// чтобы Ops мог показать, почему конкретная нода сейчас неактивна.
describe("setEndpointActive", () => {
  function createPolicyCompliantEndpoints() {
    const base = {
      label: "test endpoint",
      ipAddress: "127.0.0.1",
      protocol: "vless",
      transportProfile: "reality-tcp",
      latencyMs: 10,
      loadPercent: 0,
      consecutiveHealthFailures: 0,
      lastHealthCheckAt: null,
      lastHealthCheckOk: null,
      transportConfig: null,
      createdAt: new Date("2026-07-01T00:00:00.000Z")
    };

    return [
      { ...base, id: "ep-1", provider: "Hetzner", asn: 24940, countryCode: "DE", isActive: true, serverPool: { code: "fra-a", region: "Germany" } },
      { ...base, id: "ep-2", provider: "Leaseweb", asn: 16265, countryCode: "NL", isActive: true, serverPool: { code: "ams-b", region: "Netherlands" } },
      { ...base, id: "ep-3", provider: "OVH", asn: 16276, countryCode: "PL", isActive: true, serverPool: { code: "waw-c", region: "Poland" } },
      { ...base, id: "ep-4", provider: "Scaleway", asn: 12876, countryCode: "FR", isActive: true, serverPool: { code: "par-d", region: "France" } }
    ];
  }

  function createPrismaStub(rows: ReturnType<typeof createPolicyCompliantEndpoints>) {
    const byId = new Map(rows.map((row) => [row.id, { ...row }]));

    return {
      endpoint: {
        findUnique: async ({ where }: { where: { id: string } }) => byId.get(where.id) ?? null,
        findMany: async () => rows.filter((row) => row.isActive),
        update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const existing = byId.get(where.id)!;
          const updated = { ...existing, ...data };
          byId.set(where.id, updated);
          return updated;
        }
      }
    };
  }

  it("retiring an endpoint stamps retiredAt/retiredReason='manual' by default", async () => {
    const prisma = createPrismaStub(createPolicyCompliantEndpoints());
    const store = createEndpointsStore(prisma as never);

    const result = await store.setEndpointActive("ep-4", false);

    expect(result.isActive).toBe(false);
    expect(result.retiredReason).toBe("manual");
    expect(result.retiredAt).not.toBeNull();
  });

  it("accepts a custom retiredReason", async () => {
    const prisma = createPrismaStub(createPolicyCompliantEndpoints());
    const store = createEndpointsStore(prisma as never);

    const result = await store.setEndpointActive("ep-4", false, "provider decommissioned the box");

    expect(result.retiredReason).toBe("provider decommissioned the box");
  });

  it("reactivating an endpoint clears retiredAt/retiredReason", async () => {
    const rows = createPolicyCompliantEndpoints();
    rows[3].isActive = false;
    (rows[3] as { retiredReason?: string }).retiredReason = "manual";
    const prisma = createPrismaStub(rows);
    const store = createEndpointsStore(prisma as never);

    const result = await store.setEndpointActive("ep-4", true);

    expect(result.isActive).toBe(true);
    expect(result.retiredAt).toBeNull();
    expect(result.retiredReason).toBeNull();
  });
});

// Протокольная diversity (Decision 052) — registerEndpoint() теперь
// диспатчит по protocol вместо жёсткой vless+REALITY-схемы.
describe("registerEndpoint", () => {
  function createPrismaStub() {
    const createCalls: Array<{ data: Record<string, unknown> }> = [];

    return {
      prisma: {
        serverPool: {
          upsert: async ({ create }: { create: { id: string; code: string } }) => ({ id: create.id, code: create.code })
        },
        endpoint: {
          create: async ({ data }: { data: Record<string, unknown> }) => {
            createCalls.push({ data });
            return {
              id: data.id,
              ...data,
              createdAt: new Date("2026-07-12T00:00:00.000Z"),
              lastHealthCheckAt: null,
              lastHealthCheckOk: null,
              consecutiveHealthFailures: 0,
              retiredAt: null,
              retiredReason: null,
              transportConfig: (data.transportConfig as { create?: unknown } | undefined)?.create ?? null,
              serverPool: { code: "pool-a", region: "Germany" }
            };
          }
        }
      },
      createCalls
    };
  }

  const baseInput = {
    label: "Test node",
    ipAddress: "203.0.113.10",
    provider: "Hetzner",
    countryCode: "DE",
    poolCode: "pool-a",
    port: 8443
  };

  it("creates a vless endpoint with transportConfig when protocol=vless", async () => {
    const { prisma, createCalls } = createPrismaStub();
    const store = createEndpointsStore(prisma as never);

    await store.registerEndpoint({
      ...baseInput,
      protocol: "vless",
      transportProfile: "reality-tcp",
      publicKey: "pk",
      shortId: "sid",
      sni: "www.microsoft.com"
    });

    expect(createCalls).toHaveLength(1);
    const data = createCalls[0].data as { transportConfig?: unknown; trojanTransportConfig?: unknown; shadowsocksTransportConfig?: unknown };
    expect(data.transportConfig).toBeDefined();
    expect(data.trojanTransportConfig).toBeUndefined();
    expect(data.shadowsocksTransportConfig).toBeUndefined();
  });

  it("creates a trojan endpoint with trojanTransportConfig when protocol=trojan", async () => {
    const { prisma, createCalls } = createPrismaStub();
    const store = createEndpointsStore(prisma as never);

    await store.registerEndpoint({
      ...baseInput,
      protocol: "trojan",
      transportProfile: "tls-tcp",
      trojanSni: "www.microsoft.com"
    });

    const data = createCalls[0].data as { transportConfig?: unknown; trojanTransportConfig?: { create: { sni: string } } };
    expect(data.transportConfig).toBeUndefined();
    expect(data.trojanTransportConfig?.create.sni).toBe("www.microsoft.com");
  });

  it("creates a shadowsocks-2022 endpoint with shadowsocksTransportConfig when protocol=shadowsocks-2022", async () => {
    const { prisma, createCalls } = createPrismaStub();
    const store = createEndpointsStore(prisma as never);

    await store.registerEndpoint({
      ...baseInput,
      protocol: "shadowsocks-2022",
      transportProfile: "tcp-emergency",
      ssServerKey: "c2VydmVyLWtleQ"
    });

    const data = createCalls[0].data as { shadowsocksTransportConfig?: { create: { serverKey: string; method: string } } };
    expect(data.shadowsocksTransportConfig?.create.serverKey).toBe("c2VydmVyLWtleQ");
    expect(data.shadowsocksTransportConfig?.create.method).toBe("2022-blake3-aes-256-gcm");
  });

  it("rejects protocol=vless without publicKey/shortId/sni", async () => {
    const { prisma } = createPrismaStub();
    const store = createEndpointsStore(prisma as never);

    await expect(
      store.registerEndpoint({ ...baseInput, protocol: "vless", transportProfile: "reality-tcp" })
    ).rejects.toThrow("publicKey, shortId and sni are required");
  });

  it("rejects protocol=trojan without trojanSni", async () => {
    const { prisma } = createPrismaStub();
    const store = createEndpointsStore(prisma as never);

    await expect(
      store.registerEndpoint({ ...baseInput, protocol: "trojan", transportProfile: "tls-tcp" })
    ).rejects.toThrow("trojanSni is required");
  });

  it("rejects protocol=shadowsocks-2022 without ssServerKey", async () => {
    const { prisma } = createPrismaStub();
    const store = createEndpointsStore(prisma as never);

    await expect(
      store.registerEndpoint({ ...baseInput, protocol: "shadowsocks-2022", transportProfile: "tcp-emergency" })
    ).rejects.toThrow("ssServerKey is required");
  });

  it("rejects an unknown protocol", async () => {
    const { prisma } = createPrismaStub();
    const store = createEndpointsStore(prisma as never);

    await expect(
      store.registerEndpoint({ ...baseInput, protocol: "wireguard", transportProfile: "udp" })
    ).rejects.toThrow("protocol must be one of vless, trojan, shadowsocks-2022");
  });
});

// Шаг 2 (PRIORITY_PLAN.md) — источник правды для deploy/xray/sync-clients.sh
// (per-user client-id sync на Xray-ноды). Только users с непустым
// vlessUuid должны попасть в список — остальные ещё ни разу не подключались.
describe("listVlessClients", () => {
  it("returns uuid/flow for every user with a non-null vlessUuid", async () => {
    const prisma = {
      user: {
        findMany: async () => [{ vlessUuid: "uuid-1" }, { vlessUuid: "uuid-2" }]
      }
    };

    const store = createEndpointsStore(prisma as never);
    const clients = await store.listVlessClients();

    expect(clients).toEqual([
      { uuid: "uuid-1", flow: "xtls-rprx-vision" },
      { uuid: "uuid-2", flow: "xtls-rprx-vision" }
    ]);
  });

  it("returns an empty list when no user has a vlessUuid yet", async () => {
    const prisma = {
      user: {
        findMany: async () => []
      }
    };

    const store = createEndpointsStore(prisma as never);
    const clients = await store.listVlessClients();

    expect(clients).toEqual([]);
  });
});

// Протокольная diversity (Decision 052) — тот же паттерн, что
// listVlessClients, для User.trojanPassword/User.shadowsocksUserKey.
describe("listTrojanClients", () => {
  it("returns password for every user with a non-null trojanPassword", async () => {
    const prisma = {
      user: {
        findMany: async () => [{ trojanPassword: "pass-1" }, { trojanPassword: "pass-2" }]
      }
    };

    const store = createEndpointsStore(prisma as never);
    const clients = await store.listTrojanClients();

    expect(clients).toEqual([{ password: "pass-1" }, { password: "pass-2" }]);
  });

  it("returns an empty list when no user has a trojanPassword yet", async () => {
    const prisma = { user: { findMany: async () => [] } };
    const store = createEndpointsStore(prisma as never);

    expect(await store.listTrojanClients()).toEqual([]);
  });
});

describe("listShadowsocksClients", () => {
  it("returns password (userKey) for every user with a non-null shadowsocksUserKey", async () => {
    const prisma = {
      user: {
        findMany: async () => [{ shadowsocksUserKey: "key-1" }, { shadowsocksUserKey: "key-2" }]
      }
    };

    const store = createEndpointsStore(prisma as never);
    const clients = await store.listShadowsocksClients();

    expect(clients).toEqual([{ password: "key-1" }, { password: "key-2" }]);
  });

  it("returns an empty list when no user has a shadowsocksUserKey yet", async () => {
    const prisma = { user: { findMany: async () => [] } };
    const store = createEndpointsStore(prisma as never);

    expect(await store.listShadowsocksClients()).toEqual([]);
  });
});
