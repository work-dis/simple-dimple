import "dotenv/config";

import { createRouteReprobeWorker } from "./route-reprobe.js";
import { createEndpointHealthCheckWorker } from "./endpoint-healthcheck-worker.js";
import { createBackendRuntime } from "./runtime.js";
import { defaultAuthSession } from "./defaults.js";

const runtime = createBackendRuntime(process.env.DATABASE_URL);

// Reprobe-джобы (`POST /api/ops/route-reprobe-jobs`) — это системные/сетевые
// проверки по контексту (networkType/asn/...), а не задачи конкретного юзера.
// Раньше воркер брал "последнего залогинившегося юзера глобально" (readState()),
// из-за чего телеметрия ошибочно приписывалась случайному юзеру. Правильно —
// анонимный auth: resolveRouteDecision уже null-safe по auth.userId.
const worker = createRouteReprobeWorker({
  auth: () => defaultAuthSession,
  resolveRouteDecision: (input) => runtime.resolveRouteDecision(defaultAuthSession, input),
  recordRouteFeedback: runtime.store.recordRouteFeedback,
  recordRouteWorkflowSnapshot: runtime.store.recordRouteWorkflowSnapshot,
  refreshOpsAlerts: runtime.store.refreshOpsAlerts,
  enqueueJob: runtime.store.enqueueRouteReprobeJob,
  listJobs: runtime.store.listRouteReprobeJobs,
  claimNextJob: runtime.store.claimRouteReprobeJob,
  completeJob: runtime.store.completeRouteReprobeJob,
  failJob: runtime.store.failRouteReprobeJob,
  leaseMs: Number(process.env.ROUTE_REPROBE_WORKER_LEASE_MS ?? 30_000),
  pollIntervalMs: Number(process.env.ROUTE_REPROBE_WORKER_POLL_MS ?? 2_000),
  opsAlertRefreshIntervalMs: Number(process.env.OPS_ALERT_REFRESH_INTERVAL_MS ?? 60_000)
});

const endpointHealthCheckWorker = createEndpointHealthCheckWorker({
  listCheckableEndpoints: runtime.store.listCheckableEndpoints,
  applyHealthCheckResult: runtime.store.applyHealthCheckResult,
  intervalMs: Number(process.env.ENDPOINT_HEALTHCHECK_INTERVAL_MS ?? 15_000),
  timeoutMs: Number(process.env.ENDPOINT_HEALTHCHECK_TIMEOUT_MS ?? 4_000)
});

let stopping = false;

async function shutdown(signal: string) {
  if (stopping) {
    return;
  }

  stopping = true;
  console.info(`[route-reprobe-worker] received ${signal}, stopping worker`);
  worker.stop();
  endpointHealthCheckWorker.stop();
  await runtime.disconnect();
}

process.once("SIGINT", () => {
  void shutdown("SIGINT");
});

process.once("SIGTERM", () => {
  void shutdown("SIGTERM");
});

worker.start();
endpointHealthCheckWorker.start();
console.info("[route-reprobe-worker] started");
console.info("[endpoint-healthcheck-worker] started");
