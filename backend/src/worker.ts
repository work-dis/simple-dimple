import "dotenv/config";

import { createRouteReprobeWorker } from "./route-reprobe.js";
import { createBackendRuntime } from "./runtime.js";

const runtime = createBackendRuntime(process.env.DATABASE_URL);

const worker = createRouteReprobeWorker({
  auth: runtime.loadAuth,
  resolveRouteDecision: runtime.resolveRouteDecisionForActiveAuth,
  recordRouteFeedback: runtime.store.recordRouteFeedback,
  recordRouteWorkflowSnapshot: runtime.store.recordRouteWorkflowSnapshot,
  enqueueJob: runtime.store.enqueueRouteReprobeJob,
  listJobs: runtime.store.listRouteReprobeJobs,
  claimNextJob: runtime.store.claimRouteReprobeJob,
  completeJob: runtime.store.completeRouteReprobeJob,
  failJob: runtime.store.failRouteReprobeJob,
  leaseMs: Number(process.env.ROUTE_REPROBE_WORKER_LEASE_MS ?? 30_000),
  pollIntervalMs: Number(process.env.ROUTE_REPROBE_WORKER_POLL_MS ?? 2_000)
});

let stopping = false;

async function shutdown(signal: string) {
  if (stopping) {
    return;
  }

  stopping = true;
  console.info(`[route-reprobe-worker] received ${signal}, stopping worker`);
  worker.stop();
  await runtime.disconnect();
}

process.once("SIGINT", () => {
  void shutdown("SIGINT");
});

process.once("SIGTERM", () => {
  void shutdown("SIGTERM");
});

worker.start();
console.info("[route-reprobe-worker] started");
