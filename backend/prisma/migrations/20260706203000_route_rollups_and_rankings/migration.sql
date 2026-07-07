CREATE TABLE "RouteSuccessRollup" (
    "id" TEXT NOT NULL,
    "timeBucketStart" TIMESTAMP(3) NOT NULL,
    "timeBucketEnd" TIMESTAMP(3) NOT NULL,
    "networkFingerprintId" TEXT,
    "endpointId" TEXT,
    "transportProfile" TEXT NOT NULL,
    "successRate" DECIMAL(5,4) NOT NULL,
    "medianConnectTimeMs" INTEGER,
    "disconnectRate" DECIMAL(5,4),
    "sampleCount" INTEGER NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RouteSuccessRollup_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RouteRanking" (
    "id" TEXT NOT NULL,
    "networkFingerprintId" TEXT,
    "endpointId" TEXT,
    "transportProfile" TEXT NOT NULL,
    "score" DECIMAL(8,4) NOT NULL,
    "rankPosition" INTEGER NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "RouteRanking_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RouteSuccessRollup_endpointId_transportProfile_timeBucketEnd_idx" ON "RouteSuccessRollup"("endpointId", "transportProfile", "timeBucketEnd" DESC);
CREATE INDEX "RouteSuccessRollup_networkFingerprintId_timeBucketEnd_idx" ON "RouteSuccessRollup"("networkFingerprintId", "timeBucketEnd" DESC);
CREATE INDEX "RouteRanking_networkFingerprintId_rankPosition_idx" ON "RouteRanking"("networkFingerprintId", "rankPosition");

ALTER TABLE "RouteSuccessRollup" ADD CONSTRAINT "RouteSuccessRollup_networkFingerprintId_fkey" FOREIGN KEY ("networkFingerprintId") REFERENCES "NetworkFingerprint"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RouteSuccessRollup" ADD CONSTRAINT "RouteSuccessRollup_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "Endpoint"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RouteRanking" ADD CONSTRAINT "RouteRanking_networkFingerprintId_fkey" FOREIGN KEY ("networkFingerprintId") REFERENCES "NetworkFingerprint"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RouteRanking" ADD CONSTRAINT "RouteRanking_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "Endpoint"("id") ON DELETE SET NULL ON UPDATE CASCADE;
