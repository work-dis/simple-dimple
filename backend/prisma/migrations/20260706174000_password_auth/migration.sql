ALTER TYPE "AuthProvider" ADD VALUE IF NOT EXISTS 'credentials';

ALTER TABLE "AuthSession" DROP CONSTRAINT "AuthSession_userId_fkey";

ALTER TABLE "AuthSession"
ALTER COLUMN "userId" DROP NOT NULL;

ALTER TABLE "AuthSession"
ADD CONSTRAINT "AuthSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "PasswordCredential" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "login" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PasswordCredential_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PasswordCredential_userId_key" ON "PasswordCredential"("userId");
CREATE UNIQUE INDEX "PasswordCredential_login_key" ON "PasswordCredential"("login");

ALTER TABLE "PasswordCredential" ADD CONSTRAINT "PasswordCredential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
