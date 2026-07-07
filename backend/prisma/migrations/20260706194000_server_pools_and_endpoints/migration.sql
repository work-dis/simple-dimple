CREATE TABLE "ServerPool" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "asn" INTEGER,
    "countryCode" TEXT NOT NULL,
    "region" TEXT,
    "priority" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServerPool_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Endpoint" (
    "id" TEXT NOT NULL,
    "serverPoolId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "ipAddress" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "asn" INTEGER,
    "countryCode" TEXT NOT NULL,
    "city" TEXT,
    "transportProfile" TEXT NOT NULL,
    "protocol" TEXT NOT NULL,
    "latencyMs" INTEGER NOT NULL,
    "loadPercent" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Endpoint_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ServerPool_code_key" ON "ServerPool"("code");
CREATE INDEX "Endpoint_serverPoolId_isActive_idx" ON "Endpoint"("serverPoolId", "isActive");
CREATE INDEX "Endpoint_ipAddress_idx" ON "Endpoint"("ipAddress");
CREATE INDEX "Endpoint_asn_countryCode_idx" ON "Endpoint"("asn", "countryCode");

ALTER TABLE "Endpoint" ADD CONSTRAINT "Endpoint_serverPoolId_fkey" FOREIGN KEY ("serverPoolId") REFERENCES "ServerPool"("id") ON DELETE CASCADE ON UPDATE CASCADE;
