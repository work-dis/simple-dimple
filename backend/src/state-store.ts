import { PrismaClient } from "./generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";

import { createAuthStore } from "./store/auth.js";
import { createSessionStore } from "./store/session.js";
import { createTelemetryStore } from "./store/telemetry.js";
import { createAdminStore } from "./store/admin.js";
import { createRouteReprobeJobStore } from "./store/route-reprobe-jobs.js";
import { createOpsAlertStore } from "./store/ops-alerts.js";
import { createOpsAlertDeliveryTransport } from "./store/ops-alert-delivery.js";
import { createConnectionConfigStore } from "./store/connection-config.js";
import { createEndpointHealthCheckStore } from "./store/endpoint-healthcheck.js";
import { createEndpointsStore } from "./store/endpoints.js";
import { createMessageTransport } from "./transport/message-transport.js";

// --------------------------------------------------------------------------
// Orchestrator: creates PrismaClient + composes domain stores
// --------------------------------------------------------------------------

export function createStateStore(databaseUrl?: string) {
  const connectionString = databaseUrl ?? process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }

  const prisma = new PrismaClient({
    adapter: new PrismaPg(connectionString)
  });

  const auth = createAuthStore(prisma, createMessageTransport());
  const session = createSessionStore(prisma);
  const telemetry = createTelemetryStore(prisma);
  const admin = createAdminStore(prisma);
  const routeReprobeJobs = createRouteReprobeJobStore(prisma);
  const connectionConfig = createConnectionConfigStore(prisma);
  const endpointHealthCheck = createEndpointHealthCheckStore(prisma);
  const endpoints = createEndpointsStore(prisma);
  const opsAlertDeliveryTransport = createOpsAlertDeliveryTransport();
  const opsAlerts = createOpsAlertStore(prisma, {
    getRouteDecisionOpsSummary: (input) => admin.getRouteDecisionOpsSummary(input ?? {}),
    deliveryTransport: opsAlertDeliveryTransport,
    immediateDeliveryCooldownMs: Number(process.env.OPS_ALERT_IMMEDIATE_COOLDOWN_MS ?? 15 * 60_000),
    digestDeliveryCooldownMs: Number(process.env.OPS_ALERT_DIGEST_COOLDOWN_MS ?? 6 * 60 * 60_000),
    digestCadenceMs: Number(process.env.OPS_ALERT_DIGEST_CADENCE_MS ?? 12 * 60 * 60_000),
    digestWindowStartHourUtc: Number(process.env.OPS_ALERT_DIGEST_WINDOW_START_HOUR_UTC ?? 7),
    digestWindowEndHourUtc: Number(process.env.OPS_ALERT_DIGEST_WINDOW_END_HOUR_UTC ?? 23)
  });

  return {
    // Auth
    loginWithPassword: auth.loginWithPassword,
    registerWithPassword: auth.registerWithPassword,
    readAuthContext: auth.readAuthContext,
    requestAuthChallenge: auth.requestAuthChallenge,
    verifyAuthChallenge: auth.verifyAuthChallenge,
    logout: auth.logout,

    // Session
    readConnectionState: session.readConnectionState,
    updateAccountProfile: session.updateAccountProfile,
    writeSession: session.writeSession,
    listServers: session.listServers,
    getCurrentAssignment: session.getCurrentAssignment,
    getLastKnownGoodRoute: session.getLastKnownGoodRoute,
    assignEndpoint: session.assignEndpoint,
    recordLastKnownGoodRoute: session.recordLastKnownGoodRoute,
    issueConnectionConfig: connectionConfig.issueConnectionConfig,

    // Endpoint health checks
    listCheckableEndpoints: endpointHealthCheck.listCheckableEndpoints,
    applyHealthCheckResult: endpointHealthCheck.applyHealthCheckResult,

    // Fleet provisioning (Шаг 5, PRIORITY_PLAN.md)
    listAdminEndpoints: endpoints.listAdminEndpoints,
    registerEndpoint: endpoints.registerEndpoint,
    setEndpointActive: endpoints.setEndpointActive,
    listVlessClients: endpoints.listVlessClients,
    recordPoolClientsSync: endpoints.recordPoolClientsSync,

    // Telemetry
    submitProbeReport: telemetry.submitProbeReport,
    recordRouteFeedback: telemetry.recordRouteFeedback,
    recordRouteWorkflowSnapshot: telemetry.recordRouteWorkflowSnapshot,
    getHealthSnapshots: telemetry.getHealthSnapshots,
    getRankings: telemetry.getRankings,

    // Admin
    listAdminUsers: admin.listAdminUsers,
    updateAdmin: admin.updateAdmin,
    getRouteDecisionOpsSummary: admin.getRouteDecisionOpsSummary,
    getOpsSummary: admin.getOpsSummary,
    listOpsAlerts: opsAlerts.list,
    acknowledgeOpsAlert: opsAlerts.acknowledge,
    snoozeOpsAlert: opsAlerts.snooze,
    unacknowledgeOpsAlert: opsAlerts.unacknowledge,
    getOpsAlertEscalationPreview: opsAlerts.getEscalationPreview,
    listOpsAlertDeliveries: opsAlerts.listDeliveries,
    deliverOpsAlert: opsAlerts.deliver,
    retryOpsAlertDelivery: opsAlerts.retryDelivery,
    resendOpsAlertDelivery: opsAlerts.resendDelivery,
    deliverOpsAlertDigest: opsAlerts.deliverDigest,
    refreshOpsAlerts: opsAlerts.refreshFromOpsSummary,

    // Route reprobe jobs
    enqueueRouteReprobeJob: routeReprobeJobs.enqueue,
    listRouteReprobeJobs: routeReprobeJobs.list,
    claimRouteReprobeJob: routeReprobeJobs.claimNext,
    completeRouteReprobeJob: routeReprobeJobs.complete,
    failRouteReprobeJob: routeReprobeJobs.fail,

    // Raw access (for edge cases / migration)
    getPrisma() {
      return prisma;
    },

    async disconnect() {
      await prisma.$disconnect();
    }
  };
}

export type StateStore = ReturnType<typeof createStateStore>;
