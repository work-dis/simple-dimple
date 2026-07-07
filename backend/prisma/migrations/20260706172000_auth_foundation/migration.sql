-- CreateEnum
CREATE TYPE "ContactType" AS ENUM ('telegram', 'email');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('active', 'blocked', 'trial');

-- CreateEnum
CREATE TYPE "AuthProvider" AS ENUM ('dev', 'telegram', 'email');

-- CreateEnum
CREATE TYPE "AuthSessionStatus" AS ENUM ('active', 'revoked', 'expired');

-- AlterTable
ALTER TABLE "User"
ADD COLUMN "contactType" "ContactType" NOT NULL DEFAULT 'telegram',
ADD COLUMN "status" "UserStatus" NOT NULL DEFAULT 'active';

-- CreateTable
CREATE TABLE "AuthSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "AuthProvider" NOT NULL,
    "status" "AuthSessionStatus" NOT NULL,
    "lastAuthenticatedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuthSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuthSession_userId_status_idx" ON "AuthSession"("userId", "status");

-- AddForeignKey
ALTER TABLE "AuthSession" ADD CONSTRAINT "AuthSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
