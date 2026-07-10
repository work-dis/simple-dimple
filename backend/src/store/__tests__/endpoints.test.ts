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
