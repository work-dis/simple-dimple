ALTER TABLE "RouteReprobeJob"
ADD COLUMN "maxAttempts" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN "nextAttemptAt" TIMESTAMP(3),
ADD COLUMN "leaseReclaimedCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "deadLetteredAt" TIMESTAMP(3),
ADD COLUMN "attemptAudit" JSONB NOT NULL DEFAULT '[]';

UPDATE "RouteReprobeJob"
SET "nextAttemptAt" = COALESCE("createdAt", NOW())
WHERE "nextAttemptAt" IS NULL;

CREATE INDEX "RouteReprobeJob_status_nextAttemptAt_idx" ON "RouteReprobeJob"("status", "nextAttemptAt");
