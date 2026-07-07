import { PrismaClient } from "./generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";

import { createAuthStore } from "./store/auth.js";
import { createSessionStore } from "./store/session.js";
import { createTelemetryStore } from "./store/telemetry.js";
import { createAdminStore } from "./store/admin.js";
import { createRouteReprobeJobStore } from "./store/route-reprobe-jobs.js";
import type {
  AccountSummary,
  AdminUserSummary,
  AuthSessionSummary,
  EndpointAssignmentSummary,
  LastKnownGoodRouteSummary,
  LoginWithPasswordBody,
  PersistedState,
  RegisterWithPasswordBody,
  RequestAuthChallengeBody,
  RouteHealthSnapshotSummary,
  ServerOption,
  SessionState,
  TelemetryNetworkContext,
  TelemetryProbeResult,
  VerifyAuthChallengeBody,
  VerificationChallengeProvider
} from "./types.js";

// --------------------------------------------------------------------------
// Orchestrator: creates PrismaClient + composes domain stores
// --------------------------------------------------------------------------

export function createStateStore(databaseUrl?: string) {
  const connectionString = databaseUrl ?? process.env.DATABASE_URL ?? "postgresql://simpledimple:change-me@localhost:5432/simple_dimple";
  const prisma = new PrismaClient({
    adapter: new PrismaPg(connectionString)
  });

  const auth = createAuthStore(prisma);
  const session = createSessionStore(prisma);
  const telemetry = createTelemetryStore(prisma);
  const admin = createAdminStore(prisma);
  const routeReprobeJobs = createRouteReprobeJobStore(prisma);

  return {
    // Auth
    loginWithPassword: auth.loginWithPassword,
    registerWithPassword: auth.registerWithPassword,
    requestAuthChallenge: auth.requestAuthChallenge,
    verifyAuthChallenge: auth.verifyAuthChallenge,
    logout: auth.logout,

    // Session
    readState: session.readState,
    writeState: session.writeState,
    writeSession: session.writeSession,
    listServers: session.listServers,
    getCurrentAssignment: session.getCurrentAssignment,
    getLastKnownGoodRoute: session.getLastKnownGoodRoute,
    assignEndpoint: session.assignEndpoint,
    recordLastKnownGoodRoute: session.recordLastKnownGoodRoute,

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
