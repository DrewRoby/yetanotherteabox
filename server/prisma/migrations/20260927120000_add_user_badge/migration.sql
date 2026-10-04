-- AlterTable
ALTER TABLE "User" ADD COLUMN "badgeCodeHash" TEXT;
ALTER TABLE "User" ADD COLUMN "badgeIssuedAt" DATETIME;

-- CreateIndex
CREATE UNIQUE INDEX "User_badgeCodeHash_key" ON "User"("badgeCodeHash");

