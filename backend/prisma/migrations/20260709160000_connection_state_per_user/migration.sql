-- DropTable
DROP TABLE "AppSession";

-- CreateTable
CREATE TABLE "ConnectionState" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "activeServerId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "connectCount" INTEGER NOT NULL,

    CONSTRAINT "ConnectionState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ConnectionState_userId_key" ON "ConnectionState"("userId");

-- AddForeignKey
ALTER TABLE "ConnectionState" ADD CONSTRAINT "ConnectionState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
