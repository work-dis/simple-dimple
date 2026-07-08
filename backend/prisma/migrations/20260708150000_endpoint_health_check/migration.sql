-- AlterTable
ALTER TABLE "Endpoint" ADD COLUMN "lastHealthCheckAt" TIMESTAMP(3);
ALTER TABLE "Endpoint" ADD COLUMN "lastHealthCheckOk" BOOLEAN;
ALTER TABLE "Endpoint" ADD COLUMN "lastHealthCheckLatencyMs" INTEGER;
ALTER TABLE "Endpoint" ADD COLUMN "consecutiveHealthFailures" INTEGER NOT NULL DEFAULT 0;
