CREATE TYPE "VerificationChallengeStatus" AS ENUM ('pending', 'consumed', 'expired');

CREATE TABLE "VerificationChallenge" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "provider" "AuthProvider" NOT NULL,
    "target" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "status" "VerificationChallengeStatus" NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VerificationChallenge_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "VerificationChallenge_provider_target_status_idx" ON "VerificationChallenge"("provider", "target", "status");
CREATE INDEX "VerificationChallenge_userId_status_idx" ON "VerificationChallenge"("userId", "status");

ALTER TABLE "VerificationChallenge" ADD CONSTRAINT "VerificationChallenge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
