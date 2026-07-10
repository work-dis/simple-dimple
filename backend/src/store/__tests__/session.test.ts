import { describe, expect, it } from "vitest";

import { createSessionStore } from "../session.js";
import type { SessionState } from "../../types.js";

describe("createSessionStore.listServers", () => {
  it("fails closed when active inventory violates the minimum failure-domain policy", async () => {
    const prisma = {
      endpoint: {
        findMany: async () => [
          {
            id: "ep-1",
            label: "Frankfurt Alpha",
            provider: "Provider A",
            asn: 64500,
            ipAddress: "203.0.113.10",
            countryCode: "DE",
            city: "Frankfurt",
            transportProfile: "reality",
            protocol: "vless",
            latencyMs: 40,
            loadPercent: 30,
            serverPool: {
              code: "fra-a",
              region: "Germany",
              priority: 10
            }
          },
          {
            id: "ep-2",
            label: "Frankfurt Beta",
            provider: "Provider A",
            asn: 64500,
            ipAddress: "203.0.113.11",
            countryCode: "DE",
            city: "Frankfurt",
            transportProfile: "tls",
            protocol: "trojan",
            latencyMs: 42,
            loadPercent: 35,
            serverPool: {
              code: "fra-b",
              region: "Germany",
              priority: 20
            }
          }
        ]
      }
    };

    const store = createSessionStore(prisma as never);

    await expect(store.listServers()).rejects.toMatchObject({
      statusCode: 503,
      message: expect.stringContaining("Active server inventory is not policy-compliant")
    });
  });
});

describe("createSessionStore per-user connection state", () => {
  function createFakePrisma() {
    const rows = new Map<string, { userId: string } & SessionState>();

    return {
      connectionState: {
        findUnique: async ({ where }: { where: { userId: string } }) => rows.get(where.userId) ?? null,
        upsert: async ({
          where,
          create
        }: {
          where: { userId: string };
          update: SessionState;
          create: { userId: string } & SessionState;
        }) => {
          const existing = rows.get(where.userId);
          const next = existing ? { ...existing, ...create, userId: where.userId } : create;
          rows.set(where.userId, next);
          return next;
        }
      },
      endpoint: {
        findUnique: async ({ where }: { where: { id: string } }) => ({ id: where.id, isActive: true })
      }
    };
  }

  it("does not leak one user's connection status/activeServerId to another user", async () => {
    const prisma = createFakePrisma();
    const store = createSessionStore(prisma as never);

    await store.writeSession("user-a", {
      status: "connected",
      activeServerId: "nl-ams-1",
      updatedAt: new Date().toISOString(),
      connectCount: 1
    });

    const userBState = await store.readConnectionState("user-b");

    expect(userBState.status).toBe("disconnected");
    expect(userBState.activeServerId).not.toBe("nl-ams-1");

    const userAState = await store.readConnectionState("user-a");
    expect(userAState.status).toBe("connected");
    expect(userAState.activeServerId).toBe("nl-ams-1");
  });

  it("keeps a dynamically registered activeServerId that isn't in the static defaults list", async () => {
    const prisma = createFakePrisma();
    const store = createSessionStore(prisma as never);

    await store.writeSession("user-a", {
      status: "connected",
      activeServerId: "dynamically-added-endpoint",
      updatedAt: new Date().toISOString(),
      connectCount: 1
    });

    const userAState = await store.readConnectionState("user-a");
    expect(userAState.activeServerId).toBe("dynamically-added-endpoint");
  });

  it("falls back to the default server when the active endpoint has been retired", async () => {
    const prisma = createFakePrisma();
    prisma.endpoint.findUnique = async ({ where }: { where: { id: string } }) =>
      where.id === "retired-endpoint" ? { id: where.id, isActive: false } : { id: where.id, isActive: true };
    const store = createSessionStore(prisma as never);

    await store.writeSession("user-a", {
      status: "connected",
      activeServerId: "retired-endpoint",
      updatedAt: new Date().toISOString(),
      connectCount: 1
    });

    const userAState = await store.readConnectionState("user-a");
    expect(userAState.activeServerId).not.toBe("retired-endpoint");
  });
});
