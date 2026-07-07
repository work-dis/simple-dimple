CREATE TABLE "NetworkFingerprint" (
    "id" TEXT NOT NULL,
    "fingerprintHash" TEXT NOT NULL,
    "networkType" TEXT,
    "carrier" TEXT,
    "asn" INTEGER,
    "countryCode" TEXT,
    "region" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NetworkFingerprint_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProbeReport" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "deviceId" TEXT,
    "networkFingerprintId" TEXT,
    "endpointId" TEXT,
    "transportProfile" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "latencyMs" INTEGER,
    "bytesSent" BIGINT,
    "bytesReceived" BIGINT,
    "appVersion" TEXT,
    "testedAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProbeReport_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NetworkFingerprint_fingerprintHash_key" ON "NetworkFingerprint"("fingerprintHash");
CREATE INDEX "ProbeReport_testedAt_idx" ON "ProbeReport"("testedAt" DESC);
CREATE INDEX "ProbeReport_endpointId_testedAt_idx" ON "ProbeReport"("endpointId", "testedAt" DESC);
CREATE INDEX "ProbeReport_networkFingerprintId_testedAt_idx" ON "ProbeReport"("networkFingerprintId", "testedAt" DESC);
CREATE INDEX "ProbeReport_result_testedAt_idx" ON "ProbeReport"("result", "testedAt" DESC);

ALTER TABLE "ProbeReport" ADD CONSTRAINT "ProbeReport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProbeReport" ADD CONSTRAINT "ProbeReport_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProbeReport" ADD CONSTRAINT "ProbeReport_networkFingerprintId_fkey" FOREIGN KEY ("networkFingerprintId") REFERENCES "NetworkFingerprint"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProbeReport" ADD CONSTRAINT "ProbeReport_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "Endpoint"("id") ON DELETE SET NULL ON UPDATE CASCADE;
