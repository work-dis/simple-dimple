-- AlterTable
ALTER TABLE "User" ADD COLUMN "trojanPassword" TEXT;
ALTER TABLE "User" ADD COLUMN "shadowsocksUserKey" TEXT;

CREATE UNIQUE INDEX "User_trojanPassword_key" ON "User"("trojanPassword");
CREATE UNIQUE INDEX "User_shadowsocksUserKey_key" ON "User"("shadowsocksUserKey");

-- CreateTable
CREATE TABLE "TrojanTransportConfig" (
    "id" TEXT NOT NULL,
    "endpointId" TEXT NOT NULL,
    "port" INTEGER NOT NULL,
    "sni" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL DEFAULT 'chrome',
    "alpn" TEXT NOT NULL DEFAULT 'h2,http/1.1',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrojanTransportConfig_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TrojanTransportConfig_endpointId_key" ON "TrojanTransportConfig"("endpointId");

ALTER TABLE "TrojanTransportConfig" ADD CONSTRAINT "TrojanTransportConfig_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "Endpoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "ShadowsocksTransportConfig" (
    "id" TEXT NOT NULL,
    "endpointId" TEXT NOT NULL,
    "port" INTEGER NOT NULL,
    "method" TEXT NOT NULL DEFAULT '2022-blake3-aes-256-gcm',
    "serverKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShadowsocksTransportConfig_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ShadowsocksTransportConfig_endpointId_key" ON "ShadowsocksTransportConfig"("endpointId");

ALTER TABLE "ShadowsocksTransportConfig" ADD CONSTRAINT "ShadowsocksTransportConfig_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "Endpoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;
