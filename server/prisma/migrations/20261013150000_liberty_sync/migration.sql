-- AlterTable
ALTER TABLE "Payout" ADD COLUMN "legacyId" TEXT;

-- CreateTable
CREATE TABLE "SyncRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "source" TEXT NOT NULL,
    "sourceServer" TEXT,
    "sourceDatabase" TEXT,
    "sourceAsOf" DATETIME,
    "dryRun" BOOLEAN NOT NULL,
    "status" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    "counts" TEXT,
    "conflicts" TEXT,
    "error" TEXT
);

-- CreateIndex
CREATE INDEX "SyncRun_source_startedAt_idx" ON "SyncRun"("source", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Payout_legacyId_key" ON "Payout"("legacyId");

