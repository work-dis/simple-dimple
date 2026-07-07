ALTER TABLE "ProbeReport"
ADD COLUMN "failureReason" TEXT;

CREATE INDEX "ProbeReport_failureReason_testedAt_idx"
ON "ProbeReport"("failureReason", "testedAt" DESC);
