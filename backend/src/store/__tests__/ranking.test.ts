import { describe, it, expect } from "vitest";

import {
  classifyNetworkSimilarity,
  computeRankingScore,
  computeRouteHealthSnapshots,
  clampNumber,
  createTelemetryRetentionCutoffs,
  createCurrentRankingBucket,
  failureReasonPenalty,
  getFreshnessWeight,
  getNetworkLearningWeight,
} from "../utils.js";

// -------------------------------------------------------------------------
// getFreshnessWeight
// -------------------------------------------------------------------------
describe("getFreshnessWeight", () => {
  const now = new Date("2026-07-06T12:00:00Z");

  it("returns 1.0 for probes <= 30 min old", () => {
    const testedAt = new Date("2026-07-06T11:35:00Z");
    expect(getFreshnessWeight(testedAt, now)).toBe(1);
  });

  it("returns 0.85 for probes 30 min – 2 h old", () => {
    const testedAt = new Date("2026-07-06T10:15:00Z");
    expect(getFreshnessWeight(testedAt, now)).toBe(0.85);
  });

  it("returns 0.6 for probes 2–6 h old", () => {
    const testedAt = new Date("2026-07-06T08:00:00Z");
    expect(getFreshnessWeight(testedAt, now)).toBe(0.6);
  });

  it("returns 0.4 for probes 6–12 h old", () => {
    const testedAt = new Date("2026-07-06T01:00:00Z");
    expect(getFreshnessWeight(testedAt, now)).toBe(0.4);
  });

  it("returns 0.2 for probes > 12 h old", () => {
    const testedAt = new Date("2026-07-05T23:00:00Z");
    expect(getFreshnessWeight(testedAt, now)).toBe(0.2);
  });

  it("returns 1.0 for future timestamps (clamped to 0 age)", () => {
    const future = new Date("2026-07-06T13:00:00Z");
    expect(getFreshnessWeight(future, now)).toBe(1);
  });

  it("returns correct value at exact hour boundary (2h)", () => {
    const testedAt = new Date("2026-07-06T10:00:00Z");
    // exactly 2 hours → ageHours = 2 → enters the 0.85 branch
    expect(getFreshnessWeight(testedAt, now)).toBe(0.85);
  });

  it("returns correct value at exact 6h boundary", () => {
    const testedAt = new Date("2026-07-06T06:00:00Z");
    expect(getFreshnessWeight(testedAt, now)).toBe(0.6);
  });
});

// -------------------------------------------------------------------------
// failureReasonPenalty (invariant test)
// -------------------------------------------------------------------------
describe("failureReasonPenalty", () => {
  it("has entries for every failure reason", () => {
    const reasons = [
      "timeout",
      "handshake_failed",
      "connect_refused",
      "dns_blocked",
      "captive_portal",
      "packet_loss_suspected",
      "tls_error",
      "unknown",
    ] as const;
    for (const reason of reasons) {
      expect(failureReasonPenalty[reason]).toBeDefined();
      expect(failureReasonPenalty[reason]).toBeGreaterThan(0);
    }
  });

  it("penalises dns_blocked and captive_portal hardest", () => {
    expect(failureReasonPenalty.dns_blocked).toBeGreaterThanOrEqual(20);
    expect(failureReasonPenalty.captive_portal).toBeGreaterThanOrEqual(20);
  });

  it("penalises packet_loss_suspected least", () => {
    const values = Object.values(failureReasonPenalty);
    expect(failureReasonPenalty.packet_loss_suspected).toBe(Math.min(...values));
  });
});

// -------------------------------------------------------------------------
// clampNumber
// -------------------------------------------------------------------------
describe("clampNumber", () => {
  it("returns value within range", () => {
    expect(clampNumber(5, 0, 10)).toBe(5);
  });

  it("clamps below min", () => {
    expect(clampNumber(-5, 0, 10)).toBe(0);
  });

  it("clamps above max", () => {
    expect(clampNumber(15, 0, 10)).toBe(10);
  });

  it("works with negative ranges", () => {
    expect(clampNumber(-10, -5, 0)).toBe(-5);
  });
});

// -------------------------------------------------------------------------
// createCurrentRankingBucket
// -------------------------------------------------------------------------
describe("createCurrentRankingBucket", () => {
  it("returns bucketStart < bucketEnd", () => {
    const bucket = createCurrentRankingBucket();
    expect(bucket.bucketStart.getTime()).toBeLessThan(bucket.bucketEnd.getTime());
  });

  it("bucketEnd is an exact hour boundary", () => {
    const bucket = createCurrentRankingBucket();
    expect(bucket.bucketEnd.getMinutes()).toBe(0);
    expect(bucket.bucketEnd.getSeconds()).toBe(0);
    expect(bucket.bucketEnd.getMilliseconds()).toBe(0);
  });

  it("bucketStart is exactly 24 hours before bucketEnd", () => {
    const bucket = createCurrentRankingBucket();
    const diffMs = bucket.bucketEnd.getTime() - bucket.bucketStart.getTime();
    expect(diffMs).toBe(24 * 60 * 60 * 1000);
  });
});

// -------------------------------------------------------------------------
// cross-network learning
// -------------------------------------------------------------------------
describe("classifyNetworkSimilarity", () => {
  const baseFingerprint = {
    id: "fp-1",
    networkType: "mobile",
    carrier: "Carrier One",
    asn: 64500,
    countryCode: "PL",
  };

  it("treats the same fingerprint as exact", () => {
    expect(classifyNetworkSimilarity(baseFingerprint, baseFingerprint)).toBe("exact");
    expect(getNetworkLearningWeight("exact")).toBe(1);
  });

  it("prefers same ASN over looser similarity", () => {
    expect(classifyNetworkSimilarity(baseFingerprint, {
      ...baseFingerprint,
      id: "fp-2",
      carrier: "Another Carrier",
    })).toBe("same_asn");
  });

  it("matches same carrier within the same country", () => {
    expect(classifyNetworkSimilarity(baseFingerprint, {
      id: "fp-3",
      networkType: "wifi",
      carrier: "carrier one",
      asn: 64555,
      countryCode: "pl",
    })).toBe("same_carrier_country");
  });

  it("falls back to same country + network type when carrier and ASN differ", () => {
    expect(classifyNetworkSimilarity(baseFingerprint, {
      id: "fp-4",
      networkType: "mobile",
      carrier: "Different Carrier",
      asn: 64600,
      countryCode: "PL",
    })).toBe("same_country_network_type");
  });

  it("returns none when there is no useful similarity", () => {
    expect(classifyNetworkSimilarity(baseFingerprint, {
      id: "fp-5",
      networkType: "wifi",
      carrier: "Different Carrier",
      asn: 64600,
      countryCode: "DE",
    })).toBe("none");
    expect(getNetworkLearningWeight("none")).toBe(0);
  });
});

// -------------------------------------------------------------------------
// telemetry retention
// -------------------------------------------------------------------------
describe("createTelemetryRetentionCutoffs", () => {
  it("creates stable retention windows from a reference time", () => {
    const now = new Date("2026-07-07T12:00:00Z");
    const cutoffs = createTelemetryRetentionCutoffs(now);

    expect(cutoffs.probeReports.toISOString()).toBe("2026-06-23T12:00:00.000Z");
    expect(cutoffs.routeEvents.toISOString()).toBe("2026-06-07T12:00:00.000Z");
    expect(cutoffs.routeSuccessRollups.toISOString()).toBe("2026-05-23T12:00:00.000Z");
    expect(cutoffs.routeRankings.toISOString()).toBe("2026-06-30T12:00:00.000Z");
  });
});

// -------------------------------------------------------------------------
// computeRankingScore (core ranking algorithm)
// -------------------------------------------------------------------------
describe("computeRankingScore", () => {
  const sampleProbe = (overrides: Partial<{
    result: string;
    failureReason: string | null;
    latencyMs: number | null;
    testedAt: Date;
  }> = {}) => ({
    result: "connected",
    failureReason: null,
    latencyMs: 50,
    testedAt: new Date(),
    ...overrides,
  });

  it("returns higher score for better success rate", () => {
    const good = computeRankingScore({
      successRate: 0.95,
      disconnectRate: 0.01,
      sampleCount: 20,
      medianLatency: 50,
      probes: Array.from({ length: 5 }, () => sampleProbe()),
    });
    const bad = computeRankingScore({
      successRate: 0.5,
      disconnectRate: 0.2,
      sampleCount: 20,
      medianLatency: 50,
      probes: Array.from({ length: 5 }, () => sampleProbe()),
    });
    expect(good).toBeGreaterThan(bad);
  });

  it("penalises high disconnect rate", () => {
    const lowDisconnect = computeRankingScore({
      successRate: 0.9,
      disconnectRate: 0.05,
      sampleCount: 10,
      medianLatency: 50,
      probes: Array.from({ length: 3 }, () => sampleProbe()),
    });
    const highDisconnect = computeRankingScore({
      successRate: 0.9,
      disconnectRate: 0.4,
      sampleCount: 10,
      medianLatency: 50,
      probes: Array.from({ length: 3 }, () => sampleProbe()),
    });
    expect(lowDisconnect).toBeGreaterThan(highDisconnect);
  });

  it("penalises high latency", () => {
    const lowLatency = computeRankingScore({
      successRate: 0.9,
      disconnectRate: 0.05,
      sampleCount: 10,
      medianLatency: 30,
      probes: Array.from({ length: 3 }, () => sampleProbe()),
    });
    const highLatency = computeRankingScore({
      successRate: 0.9,
      disconnectRate: 0.05,
      sampleCount: 10,
      medianLatency: 600,
      probes: Array.from({ length: 3 }, () => sampleProbe()),
    });
    expect(lowLatency).toBeGreaterThan(highLatency);
  });

  it("penalises severe failure reasons (dns_blocked > unknown)", () => {
    const dnsFailed = computeRankingScore({
      successRate: 0.85,
      disconnectRate: 0.05,
      sampleCount: 10,
      medianLatency: 50,
      probes: [
        sampleProbe({ result: "failed", failureReason: "dns_blocked", testedAt: new Date() }),
        sampleProbe({ result: "connected", testedAt: new Date(Date.now() - 5 * 60 * 1000) }),
      ],
    });
    const unknownFailed = computeRankingScore({
      successRate: 0.85,
      disconnectRate: 0.05,
      sampleCount: 10,
      medianLatency: 50,
      probes: [
        sampleProbe({ result: "failed", failureReason: "unknown", testedAt: new Date() }),
        sampleProbe({ result: "connected", testedAt: new Date(Date.now() - 5 * 60 * 1000) }),
      ],
    });
    expect(dnsFailed).toBeLessThan(unknownFailed);
  });

  it("awards confidence bonus for more samples", () => {
    const fewSamples = computeRankingScore({
      successRate: 0.9,
      disconnectRate: 0.05,
      sampleCount: 3,
      medianLatency: 50,
      probes: [
        sampleProbe({ testedAt: new Date("2026-07-06T10:00:00Z") }),
      ],
    });
    const manySamples = computeRankingScore({
      successRate: 0.9,
      disconnectRate: 0.05,
      sampleCount: 30,
      medianLatency: 50,
      probes: Array.from({ length: 10 }, (_, i) =>
        sampleProbe({ testedAt: new Date(`2026-07-06T0${i}:00:00Z`) })
      ),
    });
    expect(manySamples).toBeGreaterThan(fewSamples);
  });

  it("gives recency recovery bonus if last probe connected", () => {
    const lastFailed = computeRankingScore({
      successRate: 0.85,
      disconnectRate: 0.05,
      sampleCount: 10,
      medianLatency: 50,
      probes: [
        sampleProbe({ result: "failed", failureReason: "timeout", testedAt: new Date(Date.now() - 15 * 60 * 1000) }),
        sampleProbe({ result: "connected", testedAt: new Date() }),
      ],
    });
    const lastFailedToo = computeRankingScore({
      successRate: 0.85,
      disconnectRate: 0.05,
      sampleCount: 10,
      medianLatency: 50,
      probes: [
        sampleProbe({ result: "failed", failureReason: "timeout", testedAt: new Date(Date.now() - 15 * 60 * 1000) }),
        sampleProbe({ result: "failed", failureReason: "timeout", testedAt: new Date() }),
      ],
    });
    expect(lastFailed).toBeGreaterThan(lastFailedToo);
  });

  it("returns a finite numeric score", () => {
    const score = computeRankingScore({
      successRate: 0.9,
      disconnectRate: 0.05,
      sampleCount: 10,
      medianLatency: 50,
      probes: Array.from({ length: 5 }, () => sampleProbe()),
    });
    expect(Number.isFinite(score)).toBe(true);
  });
});

// -------------------------------------------------------------------------
// computeRouteHealthSnapshots (per-endpoint health policy)
// -------------------------------------------------------------------------
describe("computeRouteHealthSnapshots", () => {
  const now = new Date("2026-07-06T12:00:00Z");

  it("returns healthy for endpoints with no failures", () => {
    const snapshots = computeRouteHealthSnapshots([
      { endpointId: "ep-1", result: "connected", failureReason: null, testedAt: new Date(now.getTime() - 10 * 60 * 1000) },
      { endpointId: "ep-1", result: "connected", failureReason: null, testedAt: now },
    ], now);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].status).toBe("healthy");
    expect(snapshots[0].penaltyScore).toBe(0);
  });

  it("marks endpoint as avoid after 3+ fresh failures", () => {
    const snapshots = computeRouteHealthSnapshots([
      { endpointId: "ep-1", result: "failed", failureReason: "timeout", testedAt: now },
      { endpointId: "ep-1", result: "failed", failureReason: "timeout", testedAt: now },
      { endpointId: "ep-1", result: "failed", failureReason: "timeout", testedAt: now },
    ], now);
    expect(snapshots[0].status).toBe("avoid");
    expect(snapshots[0].freshFailureCount).toBe(3);
  });

  it("marks endpoint as avoid after 2+ severe fresh failures", () => {
    const snapshots = computeRouteHealthSnapshots([
      { endpointId: "ep-1", result: "failed", failureReason: "dns_blocked", testedAt: now },
      { endpointId: "ep-1", result: "failed", failureReason: "dns_blocked", testedAt: now },
    ], now);
    expect(snapshots[0].status).toBe("avoid");
  });

  it("marks endpoint as penalized for moderate failures", () => {
    const snapshots = computeRouteHealthSnapshots([
      { endpointId: "ep-1", result: "failed", failureReason: "unknown", testedAt: now },
    ], now);
    expect(snapshots[0].status).toBe("penalized");
    expect(snapshots[0].penaltyScore).toBeGreaterThan(0);
  });

  it("recovers status if recent connected after failure", () => {
    const snapshots = computeRouteHealthSnapshots([
      { endpointId: "ep-1", result: "failed", failureReason: "timeout", testedAt: new Date(now.getTime() - 60 * 60 * 1000) },
      { endpointId: "ep-1", result: "failed", failureReason: "timeout", testedAt: new Date(now.getTime() - 30 * 60 * 1000) },
      { endpointId: "ep-1", result: "failed", failureReason: "timeout", testedAt: new Date(now.getTime() - 15 * 60 * 1000) },
      { endpointId: "ep-1", result: "connected", failureReason: null, testedAt: now },
    ], now);
    // Had 3 fresh failures but latest is connected → not "avoid" anymore
    expect(snapshots[0].status).not.toBe("avoid");
    expect(snapshots[0].freshFailureCount).toBe(3);
  });

  it("aggregates across multiple endpoints and sorts by penaltyScore desc", () => {
    const snapshots = computeRouteHealthSnapshots([
      { endpointId: "ep-1", result: "connected", failureReason: null, testedAt: now },
      { endpointId: "ep-2", result: "failed", failureReason: "timeout", testedAt: now },
      { endpointId: "ep-2", result: "failed", failureReason: "dns_blocked", testedAt: now },
      { endpointId: "ep-3", result: "failed", failureReason: "unknown", testedAt: new Date(now.getTime() - 10 * 60 * 1000) },
    ], now);
    expect(snapshots).toHaveLength(3);
    expect(snapshots[0].penaltyScore).toBeGreaterThanOrEqual(snapshots[1].penaltyScore);
    expect(snapshots[1].penaltyScore).toBeGreaterThanOrEqual(snapshots[2].penaltyScore);
  });

  it("skips reports without endpointId", () => {
    const snapshots = computeRouteHealthSnapshots([
      { endpointId: "ep-1", result: "connected", failureReason: null, testedAt: now },
      { endpointId: null, result: "failed", failureReason: "timeout", testedAt: now },
    ], now);
    expect(snapshots).toHaveLength(1);
  });

  it("classifies unstable result correctly", () => {
    const snapshots = computeRouteHealthSnapshots([
      { endpointId: "ep-1", result: "unstable", failureReason: "packet_loss_suspected", testedAt: now },
    ], now);
    expect(snapshots[0].penaltyScore).toBeGreaterThan(0);
    expect(snapshots[0].dominantFailureReason).toBe("packet_loss_suspected");
  });

  it("computes confidence based on sample count and time diversity", () => {
    const snapshots = computeRouteHealthSnapshots([
      { endpointId: "ep-1", result: "failed", failureReason: "timeout", testedAt: now },
      { endpointId: "ep-1", result: "failed", failureReason: "timeout", testedAt: new Date(now.getTime() - 60 * 60 * 1000) },
      { endpointId: "ep-1", result: "failed", failureReason: "timeout", testedAt: new Date(now.getTime() - 2 * 60 * 60 * 1000) },
    ], now);
    expect(snapshots[0].confidence).toBeGreaterThan(0);
    expect(snapshots[0].confidence).toBeLessThanOrEqual(1);
  });
});
