import { describe, expect, it } from "vitest";

import { buildRoutePolicy } from "../route-policy.js";
import type { RouteHealthSnapshotSummary, ServerOption } from "../types.js";

function createServer(overrides: Partial<ServerOption> & Pick<ServerOption, "id" | "label">): ServerOption {
  return {
    id: overrides.id,
    label: overrides.label,
    region: overrides.region ?? "Germany",
    countryCode: overrides.countryCode ?? "DE",
    provider: overrides.provider ?? "Provider A",
    asn: overrides.asn ?? 64500,
    ipAddress: overrides.ipAddress ?? "203.0.113.10",
    poolCode: overrides.poolCode ?? "pool-a",
    protocol: overrides.protocol ?? "vless",
    transportProfile: overrides.transportProfile ?? "reality",
    latencyMs: overrides.latencyMs ?? 40,
    latencyMeasuredAt: overrides.latencyMeasuredAt ?? null,
    loadPercent: overrides.loadPercent ?? 30
  };
}

describe("buildRoutePolicy failure-domain hardening", () => {
  it("prefers a diagnostic fallback outside the same regional domain when available", () => {
    const servers: ServerOption[] = [
      createServer({
        id: "ep-1",
        label: "Frankfurt Alpha",
        provider: "Provider A",
        asn: 64500,
        ipAddress: "203.0.113.10",
        poolCode: "fra-a",
        region: "Germany",
        countryCode: "DE",
        protocol: "vless",
        transportProfile: "reality"
      }),
      createServer({
        id: "ep-2",
        label: "Frankfurt Beta",
        provider: "Provider A",
        asn: 64500,
        ipAddress: "203.0.113.11",
        poolCode: "fra-b",
        region: "Germany",
        countryCode: "DE",
        protocol: "trojan",
        transportProfile: "tls"
      }),
      createServer({
        id: "ep-3",
        label: "Warsaw Gamma",
        provider: "Provider B",
        asn: 64510,
        ipAddress: "203.0.113.20",
        poolCode: "waw-a",
        region: "Poland",
        countryCode: "PL",
        protocol: "trojan",
        transportProfile: "tls"
      })
    ];

    const policy = buildRoutePolicy({
      servers,
      currentAssignmentEndpointId: null,
      currentAssignmentReason: null,
      lastKnownGoodEndpointId: null,
      hasNetworkRanking: true,
      routeHealthSnapshots: []
    });

    expect(policy.shortlist[0]?.endpointId).toBe("ep-1");
    expect(policy.shortlist[1]?.endpointId).toBe("ep-3");
    expect(policy.shortlist[1]?.assignmentReason).toBe("transport_diagnostic_fallback");
  });

  it("keeps shortlist spread across provider, ASN and region when independent candidates exist", () => {
    const servers: ServerOption[] = [
      createServer({
        id: "ep-1",
        label: "Frankfurt Alpha",
        provider: "Provider A",
        asn: 64500,
        ipAddress: "203.0.113.10",
        poolCode: "fra-a",
        region: "Germany",
        countryCode: "DE"
      }),
      createServer({
        id: "ep-2",
        label: "Frankfurt Beta",
        provider: "Provider A",
        asn: 64500,
        ipAddress: "203.0.113.11",
        poolCode: "fra-b",
        region: "Germany",
        countryCode: "DE"
      }),
      createServer({
        id: "ep-3",
        label: "Warsaw Gamma",
        provider: "Provider B",
        asn: 64510,
        ipAddress: "203.0.113.20",
        poolCode: "waw-a",
        region: "Poland",
        countryCode: "PL"
      }),
      createServer({
        id: "ep-4",
        label: "Amsterdam Delta",
        provider: "Provider C",
        asn: 64520,
        ipAddress: "203.0.113.30",
        poolCode: "ams-a",
        region: "Netherlands",
        countryCode: "NL"
      })
    ];

    const policy = buildRoutePolicy({
      servers,
      currentAssignmentEndpointId: null,
      currentAssignmentReason: null,
      lastKnownGoodEndpointId: null,
      hasNetworkRanking: true,
      routeHealthSnapshots: []
    });

    expect(policy.trace.diversityStageReached).toBe("strict");
    expect(policy.trace.shortlistDistinctProviders).toBeGreaterThanOrEqual(3);
    expect(policy.trace.shortlistDistinctAsns).toBeGreaterThanOrEqual(3);
    expect(policy.shortlist.slice(0, 3).map((candidate) => candidate.endpointId)).toEqual(["ep-1", "ep-3", "ep-4"]);
  });

  it("still prefers a healthier primary without giving up independent fallbacks", () => {
    const servers: ServerOption[] = [
      createServer({
        id: "ep-1",
        label: "Frankfurt Alpha",
        provider: "Provider A",
        asn: 64500,
        ipAddress: "203.0.113.10",
        poolCode: "fra-a",
        region: "Germany",
        countryCode: "DE"
      }),
      createServer({
        id: "ep-2",
        label: "Warsaw Gamma",
        provider: "Provider B",
        asn: 64510,
        ipAddress: "203.0.113.20",
        poolCode: "waw-a",
        region: "Poland",
        countryCode: "PL"
      }),
      createServer({
        id: "ep-3",
        label: "Amsterdam Delta",
        provider: "Provider C",
        asn: 64520,
        ipAddress: "203.0.113.30",
        poolCode: "ams-a",
        region: "Netherlands",
        countryCode: "NL"
      })
    ];
    const health: RouteHealthSnapshotSummary[] = [
      {
        endpointId: "ep-1",
        penaltyScore: 18,
        confidence: 0.9,
        freshFailureCount: 3,
        dominantFailureReason: "timeout",
        lastFailureAt: "2026-07-08T00:00:00.000Z",
        status: "avoid"
      }
    ];

    const policy = buildRoutePolicy({
      servers,
      currentAssignmentEndpointId: null,
      currentAssignmentReason: null,
      lastKnownGoodEndpointId: null,
      hasNetworkRanking: true,
      routeHealthSnapshots: health
    });

    expect(policy.recommendedEndpointId).toBe("ep-2");
    expect(policy.shortlist[1]?.endpointId).toBe("ep-3");
    expect(policy.trace.usedDegradedAvoidance).toBe(true);
  });
});
