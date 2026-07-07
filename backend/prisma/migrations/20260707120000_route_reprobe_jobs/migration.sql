CREATE TABLE "RouteReprobeJob" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "context" JSONB NOT NULL,
    "note" TEXT,
    "appVersion" TEXT,
    "candidateLimit" INTEGER NOT NULL,
    "results" JSONB NOT NULL,
    "recommendedEndpointId" TEXT,
    "candidates" JSONB NOT NULL,
    "recordedResultsCount" INTEGER NOT NULL DEFAULT 0,
    "failureMessage" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "leaseExpiresAt" TIMESTAMP(3),
    "workerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RouteReprobeJob_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RouteReprobeJob_status_createdAt_idx" ON "RouteReprobeJob"("status", "createdAt" DESC);
CREATE INDEX "RouteReprobeJob_leaseExpiresAt_idx" ON "RouteReprobeJob"("leaseExpiresAt");
CREATE INDEX "RouteReprobeJob_createdAt_idx" ON "RouteReprobeJob"("createdAt" DESC);
