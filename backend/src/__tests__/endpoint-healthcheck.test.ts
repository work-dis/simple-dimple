import { createServer } from "node:net";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { checkEndpointsReachability, checkTcpReachability } from "../endpoint-healthcheck.js";

describe("checkTcpReachability", () => {
  const servers: ReturnType<typeof createServer>[] = [];

  afterEach(() => {
    while (servers.length > 0) {
      servers.pop()?.close();
    }
  });

  function listen(): Promise<number> {
    return new Promise((resolve) => {
      const server = createServer((socket) => socket.end());
      servers.push(server);
      server.listen(0, "127.0.0.1", () => {
        resolve((server.address() as AddressInfo).port);
      });
    });
  }

  it("reports ok with a measured latency when the endpoint accepts the TCP connection", async () => {
    const port = await listen();

    const result = await checkTcpReachability({ endpointId: "ep-1", ipAddress: "127.0.0.1", port });

    expect(result.ok).toBe(true);
    expect(result.endpointId).toBe("ep-1");
    expect(result.error).toBeNull();
    expect(typeof result.latencyMs).toBe("number");
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("reports not-ok with no latency when nothing is listening on the port", async () => {
    const result = await checkTcpReachability({ endpointId: "ep-2", ipAddress: "127.0.0.1", port: 1 });

    expect(result.ok).toBe(false);
    expect(result.latencyMs).toBeNull();
    expect(result.error).toBeTruthy();
  });

  it("reports not-ok when the connection does not complete before the timeout", async () => {
    const result = await checkTcpReachability(
      { endpointId: "ep-3", ipAddress: "10.255.255.1", port: 8443 },
      50
    );

    expect(result.ok).toBe(false);
    expect(result.latencyMs).toBeNull();
  });
});

describe("checkEndpointsReachability", () => {
  it("checks every target independently and preserves endpointId in each result", async () => {
    const results = await checkEndpointsReachability(
      [
        { endpointId: "ep-a", ipAddress: "127.0.0.1", port: 1 },
        { endpointId: "ep-b", ipAddress: "127.0.0.1", port: 2 }
      ],
      50
    );

    expect(results.map((result) => result.endpointId)).toEqual(["ep-a", "ep-b"]);
    expect(results.every((result) => result.ok === false)).toBe(true);
  });
});
