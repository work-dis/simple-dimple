-- AlterTable
ALTER TABLE "Endpoint" ADD COLUMN "retiredAt" TIMESTAMP(3);
ALTER TABLE "Endpoint" ADD COLUMN "retiredReason" TEXT;
