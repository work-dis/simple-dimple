CREATE TABLE "UserEndpointAssignment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deviceId" TEXT,
    "endpointId" TEXT NOT NULL,
    "assignmentReason" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "UserEndpointAssignment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "UserEndpointAssignment_userId_assignedAt_idx" ON "UserEndpointAssignment"("userId", "assignedAt" DESC);
CREATE INDEX "UserEndpointAssignment_deviceId_assignedAt_idx" ON "UserEndpointAssignment"("deviceId", "assignedAt" DESC);
CREATE INDEX "UserEndpointAssignment_endpointId_assignedAt_idx" ON "UserEndpointAssignment"("endpointId", "assignedAt" DESC);

ALTER TABLE "UserEndpointAssignment" ADD CONSTRAINT "UserEndpointAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserEndpointAssignment" ADD CONSTRAINT "UserEndpointAssignment_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "UserEndpointAssignment" ADD CONSTRAINT "UserEndpointAssignment_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "Endpoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;
