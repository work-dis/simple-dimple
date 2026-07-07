CREATE TABLE "LastKnownGoodRoute" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deviceId" TEXT,
    "networkFingerprintId" TEXT,
    "endpointId" TEXT NOT NULL,
    "sourceAssignmentReason" TEXT,
    "lastSucceededAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LastKnownGoodRoute_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LastKnownGoodRoute_userId_lastSucceededAt_idx" ON "LastKnownGoodRoute"("userId", "lastSucceededAt" DESC);
CREATE INDEX "LastKnownGoodRoute_userId_networkFingerprintId_lastSucceededAt_idx" ON "LastKnownGoodRoute"("userId", "networkFingerprintId", "lastSucceededAt" DESC);
CREATE INDEX "LastKnownGoodRoute_endpointId_lastSucceededAt_idx" ON "LastKnownGoodRoute"("endpointId", "lastSucceededAt" DESC);

ALTER TABLE "LastKnownGoodRoute" ADD CONSTRAINT "LastKnownGoodRoute_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LastKnownGoodRoute" ADD CONSTRAINT "LastKnownGoodRoute_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LastKnownGoodRoute" ADD CONSTRAINT "LastKnownGoodRoute_networkFingerprintId_fkey" FOREIGN KEY ("networkFingerprintId") REFERENCES "NetworkFingerprint"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LastKnownGoodRoute" ADD CONSTRAINT "LastKnownGoodRoute_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "Endpoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;
