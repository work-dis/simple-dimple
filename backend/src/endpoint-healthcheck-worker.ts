import { checkEndpointsReachability } from "./endpoint-healthcheck.js";
import type { EndpointHealthCheckResult, EndpointHealthCheckTarget } from "./endpoint-healthcheck.js";

type EndpointHealthCheckWorkerDependencies = {
  listCheckableEndpoints: () => Promise<EndpointHealthCheckTarget[]>;
  applyHealthCheckResult: (result: EndpointHealthCheckResult) => Promise<void>;
  intervalMs?: number;
  timeoutMs?: number;
};

const defaultIntervalMs = 15_000;

export function createEndpointHealthCheckWorker(deps: EndpointHealthCheckWorkerDependencies) {
  const intervalMs = deps.intervalMs ?? defaultIntervalMs;

  let timer: NodeJS.Timeout | null = null;
  let started = false;
  let running = false;

  const runOnce = async () => {
    if (running) {
      return;
    }

    running = true;
    try {
      const targets = await deps.listCheckableEndpoints();
      if (targets.length === 0) {
        return;
      }

      const results = await checkEndpointsReachability(targets, deps.timeoutMs);
      for (const result of results) {
        await deps.applyHealthCheckResult(result);
      }
    } catch (error) {
      console.error(
        "[endpoint-healthcheck-worker] tick failed",
        error instanceof Error ? error.message : error
      );
    } finally {
      running = false;
    }
  };

  const schedule = (delayMs: number) => {
    if (!started) {
      return;
    }

    if (timer) {
      clearTimeout(timer);
    }

    timer = setTimeout(() => {
      timer = null;
      void runOnce().finally(() => schedule(intervalMs));
    }, delayMs);
  };

  return {
    start() {
      if (started) {
        return;
      }

      started = true;
      schedule(0);
    },

    stop() {
      started = false;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },

    runOnce
  };
}
