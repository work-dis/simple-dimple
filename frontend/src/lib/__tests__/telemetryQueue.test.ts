import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { enqueueTelemetryReport, flushTelemetryQueue } from "../telemetryQueue";

function createFakeLocalStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    }
  };
}

describe("telemetryQueue", () => {
  beforeEach(() => {
    vi.stubGlobal("window", { localStorage: createFakeLocalStorage() });
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does nothing when the queue is empty", async () => {
    await flushTelemetryQueue();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("resends a queued report and drops it once delivery succeeds", async () => {
    enqueueTelemetryReport("/api/telemetry/probe", '{"result":"connected"}', { "Content-Type": "application/json" });
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true } as Response);

    await flushTelemetryQueue();

    expect(fetch).toHaveBeenCalledWith(
      "/api/telemetry/probe",
      expect.objectContaining({ method: "POST", body: '{"result":"connected"}' })
    );

    await flushTelemetryQueue();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("keeps a report queued when resend fails, and retries it on the next flush", async () => {
    enqueueTelemetryReport("/api/routes/feedback", '{"result":"failed"}', {});
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false } as Response);
    await flushTelemetryQueue();

    vi.mocked(fetch).mockResolvedValueOnce({ ok: true } as Response);
    await flushTelemetryQueue();

    expect(fetch).toHaveBeenCalledTimes(2);
    await flushTelemetryQueue();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("keeps a report queued when fetch itself throws (offline)", async () => {
    enqueueTelemetryReport("/api/telemetry/probe", "{}", {});
    vi.mocked(fetch).mockRejectedValueOnce(new Error("network error"));
    await flushTelemetryQueue();

    vi.mocked(fetch).mockResolvedValueOnce({ ok: true } as Response);
    await flushTelemetryQueue();

    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("caps the queue size so it can't grow unbounded", async () => {
    for (let i = 0; i < 30; i += 1) {
      enqueueTelemetryReport("/api/telemetry/probe", JSON.stringify({ i }), {});
    }
    vi.mocked(fetch).mockResolvedValue({ ok: false } as Response);

    await flushTelemetryQueue();
    expect(fetch).toHaveBeenCalledTimes(20);
  });
});
