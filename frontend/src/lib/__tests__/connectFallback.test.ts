import { describe, expect, it, vi } from "vitest";

import { connectWithFallback } from "../connectFallback";
import type { ConnectionConfigSummary, RoutePolicyCandidate } from "../../types";

function createCandidate(overrides: Partial<RoutePolicyCandidate> & Pick<RoutePolicyCandidate, "endpointId">): RoutePolicyCandidate {
  return {
    endpointId: overrides.endpointId,
    assignmentReason: overrides.assignmentReason ?? "network_ranking_primary",
    label: overrides.label ?? overrides.endpointId,
    region: overrides.region ?? "Germany",
    provider: overrides.provider ?? "Hetzner",
    asn: overrides.asn ?? 24940,
    ipAddress: overrides.ipAddress ?? "203.0.113.10",
    poolCode: overrides.poolCode ?? "fra-a",
    protocol: overrides.protocol ?? "vless",
    transportProfile: overrides.transportProfile ?? "reality-tcp",
    latencyMs: overrides.latencyMs ?? 40,
    loadPercent: overrides.loadPercent ?? 30
  };
}

function createConfig(endpointId: string): ConnectionConfigSummary {
  return {
    endpointId,
    protocol: "vless",
    security: "reality",
    uri: `vless://uuid@${endpointId}:8443`,
    params: {
      uuid: "uuid",
      address: endpointId,
      port: 8443,
      flow: "xtls-rprx-vision",
      sni: "www.microsoft.com",
      fingerprint: "chrome",
      publicKey: "pk",
      shortId: "sid"
    }
  };
}

describe("connectWithFallback", () => {
  it("succeeds on the first candidate without fetching a new config or reporting failure", async () => {
    const candidates = [createCandidate({ endpointId: "ep-1" }), createCandidate({ endpointId: "ep-2" })];
    const initialConfig = createConfig("ep-1");
    const attemptTunnel = vi.fn().mockResolvedValue({ ok: true });
    const fetchCandidateConfig = vi.fn();
    const reportFailure = vi.fn();

    const outcome = await connectWithFallback(candidates, initialConfig, {
      attemptTunnel,
      fetchCandidateConfig,
      reportFailure
    });

    expect(outcome).toEqual({ ok: true, endpointId: "ep-1", candidate: candidates[0], attempts: 1, lastError: null });
    expect(attemptTunnel).toHaveBeenCalledTimes(1);
    expect(attemptTunnel).toHaveBeenCalledWith(initialConfig);
    expect(fetchCandidateConfig).not.toHaveBeenCalled();
    expect(reportFailure).not.toHaveBeenCalled();
  });

  it("falls back to the second candidate when the first fails, reporting feedback in order", async () => {
    const candidates = [
      createCandidate({ endpointId: "ep-1", assignmentReason: "network_ranking_primary" }),
      createCandidate({ endpointId: "ep-2", assignmentReason: "transport_diagnostic_fallback" })
    ];
    const initialConfig = createConfig("ep-1");
    const configForEp2 = createConfig("ep-2");

    const attemptTunnel = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, error: "handshake_failed" })
      .mockResolvedValueOnce({ ok: true });
    const fetchCandidateConfig = vi.fn().mockResolvedValue(configForEp2);
    const reportFailure = vi.fn().mockResolvedValue(undefined);

    const outcome = await connectWithFallback(candidates, initialConfig, {
      attemptTunnel,
      fetchCandidateConfig,
      reportFailure
    });

    expect(outcome).toEqual({ ok: true, endpointId: "ep-2", candidate: candidates[1], attempts: 2, lastError: null });
    expect(fetchCandidateConfig).toHaveBeenCalledExactlyOnceWith("ep-2");
    expect(reportFailure).toHaveBeenCalledExactlyOnceWith(candidates[0], "handshake_failed");
    expect(attemptTunnel).toHaveBeenNthCalledWith(1, initialConfig);
    expect(attemptTunnel).toHaveBeenNthCalledWith(2, configForEp2);
  });

  it("reports failure for every candidate and returns ok:false when the whole shortlist is exhausted", async () => {
    const candidates = [
      createCandidate({ endpointId: "ep-1" }),
      createCandidate({ endpointId: "ep-2" }),
      createCandidate({ endpointId: "ep-3" })
    ];
    const attemptTunnel = vi.fn().mockResolvedValue({ ok: false, error: "connect_refused" });
    const fetchCandidateConfig = vi.fn().mockImplementation((endpointId: string) => Promise.resolve(createConfig(endpointId)));
    const reportFailure = vi.fn().mockResolvedValue(undefined);

    const outcome = await connectWithFallback(candidates, createConfig("ep-1"), {
      attemptTunnel,
      fetchCandidateConfig,
      reportFailure
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.endpointId).toBeNull();
    expect(outcome.attempts).toBe(3);
    expect(outcome.lastError).toBe("connect_refused");
    expect(reportFailure).toHaveBeenCalledTimes(3);
    expect(reportFailure).toHaveBeenNthCalledWith(1, candidates[0], "connect_refused");
    expect(reportFailure).toHaveBeenNthCalledWith(2, candidates[1], "connect_refused");
    expect(reportFailure).toHaveBeenNthCalledWith(3, candidates[2], "connect_refused");
  });

  it("respects maxAttempts and does not try candidates beyond the cap", async () => {
    const candidates = [
      createCandidate({ endpointId: "ep-1" }),
      createCandidate({ endpointId: "ep-2" }),
      createCandidate({ endpointId: "ep-3" })
    ];
    const attemptTunnel = vi.fn().mockResolvedValue({ ok: false, error: "timeout" });
    const fetchCandidateConfig = vi.fn().mockImplementation((endpointId: string) => Promise.resolve(createConfig(endpointId)));
    const reportFailure = vi.fn().mockResolvedValue(undefined);

    const outcome = await connectWithFallback(candidates, createConfig("ep-1"), {
      attemptTunnel,
      fetchCandidateConfig,
      reportFailure,
      maxAttempts: 2
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.attempts).toBe(2);
    expect(attemptTunnel).toHaveBeenCalledTimes(2);
    expect(fetchCandidateConfig).toHaveBeenCalledExactlyOnceWith("ep-2");
  });

  it("skips a candidate without a resolvable config and moves to the next one", async () => {
    const candidates = [createCandidate({ endpointId: "ep-1" }), createCandidate({ endpointId: "ep-2" })];
    const attemptTunnel = vi.fn().mockResolvedValue({ ok: true });
    const fetchCandidateConfig = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(createConfig("ep-2"));
    const reportFailure = vi.fn();

    const outcome = await connectWithFallback(candidates, null, {
      attemptTunnel,
      fetchCandidateConfig,
      reportFailure
    });

    expect(outcome).toEqual({ ok: true, endpointId: "ep-2", candidate: candidates[1], attempts: 2, lastError: null });
    expect(attemptTunnel).toHaveBeenCalledTimes(1);
    expect(reportFailure).not.toHaveBeenCalled();
  });

  it("maps unrecognized tunnel errors to the unknown failure reason", async () => {
    const candidates = [createCandidate({ endpointId: "ep-1" })];
    const attemptTunnel = vi.fn().mockResolvedValue({ ok: false, error: "some native crash string" });
    const fetchCandidateConfig = vi.fn();
    const reportFailure = vi.fn().mockResolvedValue(undefined);

    await connectWithFallback(candidates, createConfig("ep-1"), {
      attemptTunnel,
      fetchCandidateConfig,
      reportFailure
    });

    expect(reportFailure).toHaveBeenCalledExactlyOnceWith(candidates[0], "unknown");
  });
});
