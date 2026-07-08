-- AlterTable
ALTER TABLE "User" ADD COLUMN "vlessUuid" TEXT;

CREATE UNIQUE INDEX "User_vlessUuid_key" ON "User"("vlessUuid");

-- CreateTable
CREATE TABLE "EndpointTransportConfig" (
    "id" TEXT NOT NULL,
    "endpointId" TEXT NOT NULL,
    "port" INTEGER NOT NULL,
    "publicKey" TEXT NOT NULL,
    "shortId" TEXT NOT NULL,
    "sni" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL DEFAULT 'chrome',
    "flow" TEXT NOT NULL DEFAULT 'xtls-rprx-vision',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EndpointTransportConfig_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EndpointTransportConfig_endpointId_key" ON "EndpointTransportConfig"("endpointId");

ALTER TABLE "EndpointTransportConfig" ADD CONSTRAINT "EndpointTransportConfig_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "Endpoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;
