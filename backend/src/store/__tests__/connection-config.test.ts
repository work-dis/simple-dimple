import { describe, expect, it } from "vitest";

import { createConnectionConfigStore } from "../connection-config.js";
import type { AuthSessionSummary } from "../../types.js";

const authenticatedAuth: AuthSessionSummary = {
  id: "session-1",
  userId: "user-1",
  provider: "credentials",
  status: "active",
  isAuthenticated: true,
  lastAuthenticatedAt: new Date().toISOString(),
  expiresAt: null
};

function createPrismaStub(input: {
  endpoint: Record<string, unknown> | null;
  vlessUuid?: string | null;
}) {
  const updateCalls: Array<{ where: unknown; data: { vlessUuid: string } }> = [];

  return {
    prisma: {
      endpoint: {
        findUnique: async () => input.endpoint
      },
      user: {
        findUnique: async () => (input.endpoint ? { vlessUuid: input.vlessUuid ?? null } : null),
        update: async ({ where, data }: { where: unknown; data: { vlessUuid: string } }) => {
          updateCalls.push({ where, data });
          return { vlessUuid: data.vlessUuid };
        }
      }
    },
    updateCalls
  };
}

const vlessEndpoint = {
  id: "de-fra-1",
  label: "Frankfurt Alpha (dev Xray inbound)",
  ipAddress: "127.0.0.1",
  protocol: "vless",
  transportConfig: {
    port: 8443,
    publicKey: "-9ABqsGJOl9OQEqG2KISZlHW3ePa2mHuCivT892kFh0",
    shortId: "1840a5c9",
    sni: "www.microsoft.com",
    fingerprint: "chrome",
    flow: "xtls-rprx-vision"
  }
};

describe("createConnectionConfigStore.issueConnectionConfig", () => {
  it("returns null when the user is not authenticated", async () => {
    const { prisma } = createPrismaStub({ endpoint: vlessEndpoint });
    const store = createConnectionConfigStore(prisma as never);

    const result = await store.issueConnectionConfig(
      { id: "s", userId: null, provider: "credentials", status: "revoked", isAuthenticated: false, lastAuthenticatedAt: null, expiresAt: null },
      "de-fra-1"
    );

    expect(result).toBeNull();
  });

  it("returns null when no endpointId is given", async () => {
    const { prisma } = createPrismaStub({ endpoint: vlessEndpoint });
    const store = createConnectionConfigStore(prisma as never);

    expect(await store.issueConnectionConfig(authenticatedAuth, null)).toBeNull();
  });

  it("returns null when the endpoint has no REALITY transport config", async () => {
    const { prisma } = createPrismaStub({ endpoint: { ...vlessEndpoint, transportConfig: null } });
    const store = createConnectionConfigStore(prisma as never);

    expect(await store.issueConnectionConfig(authenticatedAuth, "de-fra-1")).toBeNull();
  });

  it("returns null when the endpoint protocol is not vless", async () => {
    const { prisma } = createPrismaStub({ endpoint: { ...vlessEndpoint, protocol: "trojan" } });
    const store = createConnectionConfigStore(prisma as never);

    expect(await store.issueConnectionConfig(authenticatedAuth, "de-fra-1")).toBeNull();
  });

  it("generates and persists a client uuid on first issuance", async () => {
    const { prisma, updateCalls } = createPrismaStub({ endpoint: vlessEndpoint, vlessUuid: null });
    const store = createConnectionConfigStore(prisma as never);

    const result = await store.issueConnectionConfig(authenticatedAuth, "de-fra-1");

    expect(result).not.toBeNull();
    expect(updateCalls).toHaveLength(1);
    expect(result!.params.uuid).toBe(updateCalls[0].data.vlessUuid);
    expect(result!.params.publicKey).toBe(vlessEndpoint.transportConfig.publicKey);
    expect(result!.uri.startsWith(`vless://${result!.params.uuid}@127.0.0.1:8443?`)).toBe(true);
  });

  it("reuses the existing client uuid instead of generating a new one", async () => {
    const { prisma, updateCalls } = createPrismaStub({
      endpoint: vlessEndpoint,
      vlessUuid: "ef804460-59d5-48af-afe8-da294499651b"
    });
    const store = createConnectionConfigStore(prisma as never);

    const result = await store.issueConnectionConfig(authenticatedAuth, "de-fra-1");

    expect(updateCalls).toHaveLength(0);
    expect(result!.params.uuid).toBe("ef804460-59d5-48af-afe8-da294499651b");
  });
});
