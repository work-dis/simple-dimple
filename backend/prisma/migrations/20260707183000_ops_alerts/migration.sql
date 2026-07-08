CREATE TYPE "OpsAlertSeverity" AS ENUM ('watch', 'critical');
CREATE TYPE "OpsAlertStatus" AS ENUM ('active', 'acknowledged', 'snoozed', 'resolved');

CREATE TABLE "OpsAlert" (
    "id" TEXT NOT NULL,
    "alertType" TEXT NOT NULL,
    "severity" "OpsAlertSeverity" NOT NULL,
    "status" "OpsAlertStatus" NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "startedAt" TIMESTAMP(3) NOT NULL,
    "lastDetectedAt" TIMESTAMP(3) NOT NULL,
    "acknowledgedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "snoozedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OpsAlert_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OpsAlert_dedupeKey_key" ON "OpsAlert"("dedupeKey");
CREATE INDEX "OpsAlert_status_updatedAt_idx" ON "OpsAlert"("status", "updatedAt" DESC);
CREATE INDEX "OpsAlert_severity_status_updatedAt_idx" ON "OpsAlert"("severity", "status", "updatedAt" DESC);
CREATE INDEX "OpsAlert_lastDetectedAt_idx" ON "OpsAlert"("lastDetectedAt" DESC);
