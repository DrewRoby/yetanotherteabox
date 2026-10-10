-- AlterTable
ALTER TABLE "Account" ADD COLUMN "lastSaleAt" DATETIME;

-- CreateTable
CREATE TABLE "PayoutLine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "payoutId" TEXT NOT NULL,
    "lineType" TEXT NOT NULL,
    "itemId" TEXT,
    "saleId" TEXT,
    "description" TEXT,
    "amount" REAL NOT NULL,
    CONSTRAINT "PayoutLine_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "Payout" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PayoutLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "PayoutLine_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "PayoutLine_payoutId_idx" ON "PayoutLine"("payoutId");

-- CreateIndex
CREATE INDEX "PayoutLine_itemId_idx" ON "PayoutLine"("itemId");

-- CreateIndex
CREATE INDEX "PayoutLine_saleId_idx" ON "PayoutLine"("saleId");

-- CreateIndex
CREATE INDEX "Sale_itemId_idx" ON "Sale"("itemId");

-- Backfill lastSaleAt for existing data (after Sale_itemId_idx exists, so this is an
-- index lookup per account rather than a full Sale scan per account).
UPDATE "Account" SET "lastSaleAt" = (
    SELECT MAX(s."saleDate") FROM "Item" i JOIN "Sale" s ON s."itemId" = i."id" WHERE i."accountId" = "Account"."id"
);
