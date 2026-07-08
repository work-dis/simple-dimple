import { afterEach, describe, expect, it, vi } from "vitest";

import { createEndpointHealthCheckWorker } from "../endpoint-healthcheck-worker.js";

describe("createEndpointHealthCheckWorker", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("runOnce is a no-op when there are no checkable endpoints", async () => {
    const listCheckableEndpoints = vi.fn().mockResolvedValue([]);
    const applyHealthCheckResult = vi.fn();
    const worker = createEndpointHealthCheckWorker({ listCheckableEndpoints, applyHealthCheckResult });

    await worker.runOnce();

    expect(listCheckableEndpoints).toHaveBeenCalledTimes(1);
    expect(applyHealthCheckResult).not.toHaveBeenCalled();
  });

  it("runOnce swallows errors from listCheckableEndpoints instead of throwing", async () => {
    const listCheckableEndpoints = vi.fn().mockRejectedValue(new Error("db down"));
    const applyHealthCheckResult = vi.fn();
    const worker = createEndpointHealthCheckWorker({ listCheckableEndpoints, applyHealthCheckResult });

    await expect(worker.runOnce()).resolves.toBeUndefined();
  });

  it("stop() prevents any further scheduled ticks", async () => {
    vi.useFakeTimers();
    const listCheckableEndpoints = vi.fn().mockResolvedValue([]);
    const applyHealthCheckResult = vi.fn();
    const worker = createEndpointHealthCheckWorker({
      listCheckableEndpoints,
      applyHealthCheckResult,
      intervalMs: 1_000
    });

    worker.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(listCheckableEndpoints).toHaveBeenCalledTimes(1);

    worker.stop();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(listCheckableEndpoints).toHaveBeenCalledTimes(1);
  });
});
