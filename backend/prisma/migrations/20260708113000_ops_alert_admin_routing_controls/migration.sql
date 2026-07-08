ALTER TABLE "User"
ADD COLUMN "opsAlertImmediateEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "opsAlertDigestEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "opsAlertEscalationTier" TEXT NOT NULL DEFAULT 'primary';
