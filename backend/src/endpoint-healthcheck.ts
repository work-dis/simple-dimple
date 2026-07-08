import { Socket } from "node:net";

export type EndpointHealthCheckTarget = {
  endpointId: string;
  ipAddress: string;
  port: number;
};

export type EndpointHealthCheckResult = {
  endpointId: string;
  ok: boolean;
  latencyMs: number | null;
  error: string | null;
};

const defaultTimeoutMs = 4_000;

export function checkTcpReachability(
  target: EndpointHealthCheckTarget,
  timeoutMs: number = defaultTimeoutMs
): Promise<EndpointHealthCheckResult> {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const socket = new Socket();
    let settled = false;

    const finish = (ok: boolean, error: string | null) => {
      if (settled) {
        return;
      }

      settled = true;
      socket.destroy();
      resolve({
        endpointId: target.endpointId,
        ok,
        latencyMs: ok ? Date.now() - startedAt : null,
        error
      });
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true, null));
    socket.once("timeout", () => finish(false, "timeout"));
    socket.once("error", (error) => finish(false, error.message));

    socket.connect(target.port, target.ipAddress);
  });
}

export async function checkEndpointsReachability(
  targets: EndpointHealthCheckTarget[],
  timeoutMs?: number
): Promise<EndpointHealthCheckResult[]> {
  return Promise.all(targets.map((target) => checkTcpReachability(target, timeoutMs)));
}
