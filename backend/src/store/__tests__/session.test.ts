import { describe, expect, it } from "vitest";

import { createSessionStore } from "../session.js";

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
