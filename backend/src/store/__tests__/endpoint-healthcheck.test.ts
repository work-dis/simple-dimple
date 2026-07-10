import { describe, expect, it } from "vitest";

import { createEndpointHealthCheckStore } from "../endpoint-healthcheck.js";

function createPrismaStub(input: {
  endpoints: Array<{ id: string; ipAddress: string; transportConfig: { port: number } | null }>;
  endpointRow: { isActive: boolean; consecutiveHealthFailures: number; retiredReason?: string | null } | null;
}) {
  const updateCalls: Array<{ where: { id: string }; data: Record<string, unknown> }> = [];

  return {
    prisma: {
      endpoint: {
        findMany: async () => input.endpoints,
        findUnique: async () => input.endpointRow,
        update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          updateCalls.push({ where, data });
          return { id: where.id, ...data };
        }
      }
    },
    updateCalls
  };
}

describe("createEndpointHealthCheckStore.listCheckableEndpoints", () => {
  it("only returns endpoints that have a transport config, with ip/port extracted", async () => {
    const { prisma } = createPrismaStub({
      endpoints: [
        { id: "de-fra-1", ipAddress: "127.0.0.1", transportConfig: { port: 8443 } }
      ],
      endpointRow: null
    });
    const store = createEndpointHealthCheckStore(prisma as never);

    const targets = await store.listCheckableEndpoints();

    expect(targets).toEqual([{ endpointId: "de-fra-1", ipAddress: "127.0.0.1", port: 8443 }]);
  });
});

describe("createEndpointHealthCheckStore.applyHealthCheckResult", () => {
  it("marks the endpoint healthy and resets the failure streak on success", async () => {
    const { prisma, updateCalls } = createPrismaStub({
      endpoints: [],
      endpointRow: { isActive: true, consecutiveHealthFailures: 2 }
    });
    const store = createEndpointHealthCheckStore(prisma as never);

    await store.applyHealthCheckResult({ endpointId: "de-fra-1", ok: true, latencyMs: 12, error: null });

    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].data).toMatchObject({
      isActive: true,
      lastHealthCheckOk: true,
      lastHealthCheckLatencyMs: 12,
      consecutiveHealthFailures: 0
    });
  });

  it("increments the failure streak but keeps the endpoint active below the deactivation threshold", async () => {
    const { prisma, updateCalls } = createPrismaStub({
      endpoints: [],
      endpointRow: { isActive: true, consecutiveHealthFailures: 1 }
    });
    const store = createEndpointHealthCheckStore(prisma as never);

    await store.applyHealthCheckResult({ endpointId: "de-fra-1", ok: false, latencyMs: null, error: "timeout" });

    expect(updateCalls[0].data).toMatchObject({
      isActive: true,
      lastHealthCheckOk: false,
      consecutiveHealthFailures: 2
    });
  });

  it("deactivates the endpoint once the failure streak reaches the threshold, tagging it as auto-retired", async () => {
    const { prisma, updateCalls } = createPrismaStub({
      endpoints: [],
      endpointRow: { isActive: true, consecutiveHealthFailures: 2 }
    });
    const store = createEndpointHealthCheckStore(prisma as never);

    await store.applyHealthCheckResult({ endpointId: "de-fra-1", ok: false, latencyMs: null, error: "timeout" });

    expect(updateCalls[0].data).toMatchObject({
      isActive: false,
      consecutiveHealthFailures: 3,
      retiredReason: "auto_health_failure"
    });
    expect(updateCalls[0].data.retiredAt).toBeInstanceOf(Date);
  });

  it("reactivates a previously auto-deactivated endpoint once it becomes reachable again, clearing retire-audit", async () => {
    const { prisma, updateCalls } = createPrismaStub({
      endpoints: [],
      endpointRow: { isActive: false, consecutiveHealthFailures: 5, retiredReason: "auto_health_failure" }
    });
    const store = createEndpointHealthCheckStore(prisma as never);

    await store.applyHealthCheckResult({ endpointId: "de-fra-1", ok: true, latencyMs: 30, error: null });

    expect(updateCalls[0].data).toMatchObject({
      isActive: true,
      consecutiveHealthFailures: 0,
      retiredAt: null,
      retiredReason: null
    });
  });

  it("does NOT auto-reactivate a manually retired endpoint on a successful probe, only refreshes metrics", async () => {
    const { prisma, updateCalls } = createPrismaStub({
      endpoints: [],
      endpointRow: { isActive: false, consecutiveHealthFailures: 5, retiredReason: "manual" }
    });
    const store = createEndpointHealthCheckStore(prisma as never);

    await store.applyHealthCheckResult({ endpointId: "de-fra-1", ok: true, latencyMs: 30, error: null });

    expect(updateCalls[0].data).toMatchObject({
      isActive: false,
      lastHealthCheckOk: true,
      lastHealthCheckLatencyMs: 30,
      // failure streak left untouched — not reset, since this isn't a real recovery
      consecutiveHealthFailures: 5
    });
    expect(updateCalls[0].data.retiredReason).toBeUndefined();
  });

  it("does not touch failure streak or retire-audit for a manually retired endpoint that fails a probe", async () => {
    const { prisma, updateCalls } = createPrismaStub({
      endpoints: [],
      endpointRow: { isActive: false, consecutiveHealthFailures: 5, retiredReason: "manual" }
    });
    const store = createEndpointHealthCheckStore(prisma as never);

    await store.applyHealthCheckResult({ endpointId: "de-fra-1", ok: false, latencyMs: null, error: "timeout" });

    expect(updateCalls[0].data).toEqual({
      lastHealthCheckAt: expect.any(Date),
      lastHealthCheckOk: false,
      lastHealthCheckLatencyMs: null
    });
  });

  it("does nothing when the endpoint no longer exists", async () => {
    const { prisma, updateCalls } = createPrismaStub({ endpoints: [], endpointRow: null });
    const store = createEndpointHealthCheckStore(prisma as never);

    await store.applyHealthCheckResult({ endpointId: "gone", ok: true, latencyMs: 10, error: null });

    expect(updateCalls).toHaveLength(0);
  });
});
