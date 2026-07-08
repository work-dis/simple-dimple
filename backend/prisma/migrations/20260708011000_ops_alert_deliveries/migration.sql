CREATE TYPE "OpsAlertDeliveryStatus" AS ENUM ('delivered', 'failed');

CREATE TABLE "OpsAlertDelivery" (
    "id" TEXT NOT NULL,
    "opsAlertId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "channel" "ContactType" NOT NULL,
    "escalationLevel" TEXT NOT NULL,
    "status" "OpsAlertDeliveryStatus" NOT NULL,
    "recipientUserId" TEXT,
    "recipientDisplayName" TEXT NOT NULL,
    "recipientContact" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "deliveryPath" TEXT NOT NULL,
    "providerMessageId" TEXT,
    "actorUserId" TEXT,
    "deliveredAt" TIMESTAMP(3),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OpsAlertDelivery_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OpsAlertDelivery_opsAlertId_createdAt_idx" ON "OpsAlertDelivery"("opsAlertId", "createdAt" DESC);
CREATE INDEX "OpsAlertDelivery_batchId_idx" ON "OpsAlertDelivery"("batchId");
CREATE INDEX "OpsAlertDelivery_status_createdAt_idx" ON "OpsAlertDelivery"("status", "createdAt" DESC);

ALTER TABLE "OpsAlertDelivery"
ADD CONSTRAINT "OpsAlertDelivery_opsAlertId_fkey"
FOREIGN KEY ("opsAlertId") REFERENCES "OpsAlert"("id") ON DELETE CASCADE ON UPDATE CASCADE;
