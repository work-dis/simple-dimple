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
  trojanPassword?: string | null;
  shadowsocksUserKey?: string | null;
}) {
  const updateCalls: Array<{ where: unknown; data: Record<string, string> }> = [];

  return {
    prisma: {
      endpoint: {
        findUnique: async () => input.endpoint
      },
      user: {
        findUnique: async () =>
          input.endpoint
            ? {
                vlessUuid: input.vlessUuid ?? null,
                trojanPassword: input.trojanPassword ?? null,
                shadowsocksUserKey: input.shadowsocksUserKey ?? null
              }
            : null,
        update: async ({ where, data }: { where: unknown; data: Record<string, string> }) => {
          updateCalls.push({ where, data });
          return data;
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
  },
  trojanTransportConfig: null,
  shadowsocksTransportConfig: null
};

const trojanEndpoint = {
  id: "nl-ams-1",
  label: "Amsterdam Breeze",
  ipAddress: "203.0.113.20",
  protocol: "trojan",
  transportConfig: null,
  trojanTransportConfig: {
    port: 8443,
    sni: "www.microsoft.com",
    fingerprint: "chrome",
    alpn: "h2,http/1.1",
    certSha256: null
  },
  shadowsocksTransportConfig: null
};

const shadowsocksEndpoint = {
  id: "pl-waw-1",
  label: "Warsaw Pulse",
  ipAddress: "203.0.113.30",
  protocol: "shadowsocks-2022",
  transportConfig: null,
  trojanTransportConfig: null,
  shadowsocksTransportConfig: {
    port: 8388,
    method: "2022-blake3-aes-128-gcm",
    serverKey: "c2VydmVyLWtleQ"
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

  it("returns null when the endpoint protocol is unknown", async () => {
    const { prisma } = createPrismaStub({ endpoint: { ...vlessEndpoint, protocol: "wireguard" } });
    const store = createConnectionConfigStore(prisma as never);

    expect(await store.issueConnectionConfig(authenticatedAuth, "de-fra-1")).toBeNull();
  });

  it("generates and persists a client uuid on first issuance", async () => {
    const { prisma, updateCalls } = createPrismaStub({ endpoint: vlessEndpoint, vlessUuid: null });
    const store = createConnectionConfigStore(prisma as never);

    const result = await store.issueConnectionConfig(authenticatedAuth, "de-fra-1");

    expect(result).not.toBeNull();
    expect(result!.protocol).toBe("vless");
    expect(updateCalls).toHaveLength(1);
    if (result!.protocol === "vless") {
      expect(result!.params.uuid).toBe(updateCalls[0].data.vlessUuid);
      expect(result!.params.publicKey).toBe(vlessEndpoint.transportConfig.publicKey);
      expect(result!.uri.startsWith(`vless://${result!.params.uuid}@127.0.0.1:8443?`)).toBe(true);
    }
  });

  it("reuses the existing client uuid instead of generating a new one", async () => {
    const { prisma, updateCalls } = createPrismaStub({
      endpoint: vlessEndpoint,
      vlessUuid: "ef804460-59d5-48af-afe8-da294499651b"
    });
    const store = createConnectionConfigStore(prisma as never);

    const result = await store.issueConnectionConfig(authenticatedAuth, "de-fra-1");

    expect(updateCalls).toHaveLength(0);
    expect(result!.protocol === "vless" && result!.params.uuid).toBe("ef804460-59d5-48af-afe8-da294499651b");
  });

  it("returns null for a trojan endpoint with no TrojanTransportConfig", async () => {
    const { prisma } = createPrismaStub({ endpoint: { ...trojanEndpoint, trojanTransportConfig: null } });
    const store = createConnectionConfigStore(prisma as never);

    expect(await store.issueConnectionConfig(authenticatedAuth, "nl-ams-1")).toBeNull();
  });

  it("generates and persists a trojan password on first issuance", async () => {
    const { prisma, updateCalls } = createPrismaStub({ endpoint: trojanEndpoint, trojanPassword: null });
    const store = createConnectionConfigStore(prisma as never);

    const result = await store.issueConnectionConfig(authenticatedAuth, "nl-ams-1");

    expect(result).not.toBeNull();
    expect(result!.protocol).toBe("trojan");
    expect(updateCalls).toHaveLength(1);
    if (result!.protocol === "trojan") {
      expect(result!.params.password).toBe(updateCalls[0].data.trojanPassword);
      expect(result!.uri.startsWith(`trojan://${result!.params.password}@203.0.113.20:8443?`)).toBe(true);
    }
  });

  it("reuses the existing trojan password instead of generating a new one", async () => {
    const { prisma, updateCalls } = createPrismaStub({ endpoint: trojanEndpoint, trojanPassword: "existing-pass" });
    const store = createConnectionConfigStore(prisma as never);

    const result = await store.issueConnectionConfig(authenticatedAuth, "nl-ams-1");

    expect(updateCalls).toHaveLength(0);
    expect(result!.protocol === "trojan" && result!.params.password).toBe("existing-pass");
  });

  it("returns null for a shadowsocks-2022 endpoint with no ShadowsocksTransportConfig", async () => {
    const { prisma } = createPrismaStub({ endpoint: { ...shadowsocksEndpoint, shadowsocksTransportConfig: null } });
    const store = createConnectionConfigStore(prisma as never);

    expect(await store.issueConnectionConfig(authenticatedAuth, "pl-waw-1")).toBeNull();
  });

  it("generates and persists a shadowsocks user key on first issuance", async () => {
    const { prisma, updateCalls } = createPrismaStub({ endpoint: shadowsocksEndpoint, shadowsocksUserKey: null });
    const store = createConnectionConfigStore(prisma as never);

    const result = await store.issueConnectionConfig(authenticatedAuth, "pl-waw-1");

    expect(result).not.toBeNull();
    expect(result!.protocol).toBe("shadowsocks-2022");
    expect(updateCalls).toHaveLength(1);
    if (result!.protocol === "shadowsocks-2022") {
      expect(result!.params.userKey).toBe(updateCalls[0].data.shadowsocksUserKey);
      expect(result!.params.serverKey).toBe("c2VydmVyLWtleQ");
    }
  });

  it("reuses the existing shadowsocks user key instead of generating a new one", async () => {
    const { prisma, updateCalls } = createPrismaStub({
      endpoint: shadowsocksEndpoint,
      shadowsocksUserKey: "existing-user-key"
    });
    const store = createConnectionConfigStore(prisma as never);

    const result = await store.issueConnectionConfig(authenticatedAuth, "pl-waw-1");

    expect(updateCalls).toHaveLength(0);
    expect(result!.protocol === "shadowsocks-2022" && result!.params.userKey).toBe("existing-user-key");
  });
});
