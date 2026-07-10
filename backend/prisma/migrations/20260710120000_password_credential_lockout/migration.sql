-- AlterTable
ALTER TABLE "PasswordCredential" ADD COLUMN "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PasswordCredential" ADD COLUMN "lockedUntil" TIMESTAMP(3);
