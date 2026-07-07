CREATE TABLE "RouteEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "deviceId" TEXT,
    "networkFingerprintId" TEXT,
    "endpointId" TEXT,
    "transportProfile" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "feedbackResult" TEXT,
    "eventReason" TEXT,
    "metadata" JSONB NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RouteEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RouteEvent_occurredAt_idx" ON "RouteEvent"("occurredAt" DESC);
CREATE INDEX "RouteEvent_endpointId_occurredAt_idx" ON "RouteEvent"("endpointId", "occurredAt" DESC);
CREATE INDEX "RouteEvent_networkFingerprintId_occurredAt_idx" ON "RouteEvent"("networkFingerprintId", "occurredAt" DESC);
CREATE INDEX "RouteEvent_eventType_occurredAt_idx" ON "RouteEvent"("eventType", "occurredAt" DESC);

ALTER TABLE "RouteEvent"
ADD CONSTRAINT "RouteEvent_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RouteEvent"
ADD CONSTRAINT "RouteEvent_deviceId_fkey"
FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "RouteEvent"
ADD CONSTRAINT "RouteEvent_networkFingerprintId_fkey"
FOREIGN KEY ("networkFingerprintId") REFERENCES "NetworkFingerprint"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "RouteEvent"
ADD CONSTRAINT "RouteEvent_endpointId_fkey"
FOREIGN KEY ("endpointId") REFERENCES "Endpoint"("id") ON DELETE SET NULL ON UPDATE CASCADE;
