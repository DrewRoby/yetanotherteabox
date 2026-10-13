-- AlterTable
ALTER TABLE "Sale" ADD COLUMN "transactionId" TEXT;

-- CreateTable
CREATE TABLE "PrintJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "storeId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,
    "activeRole" TEXT,
    "source" TEXT NOT NULL,
    "reprintOfId" TEXT,
    "itemCount" INTEGER NOT NULL,
    CONSTRAINT "PrintJob_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PrintJob_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "PrintJob_reprintOfId_fkey" FOREIGN KEY ("reprintOfId") REFERENCES "PrintJob" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PrintJobItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "printJobId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "itemId" TEXT,
    "sku" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "price" REAL NOT NULL,
    "category" TEXT,
    "size" TEXT,
    CONSTRAINT "PrintJobItem_printJobId_fkey" FOREIGN KEY ("printJobId") REFERENCES "PrintJob" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PrintJobItem_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "PrintJob_storeId_createdAt_idx" ON "PrintJob"("storeId", "createdAt");

-- CreateIndex
CREATE INDEX "PrintJobItem_printJobId_idx" ON "PrintJobItem"("printJobId");

-- CreateIndex
CREATE INDEX "PrintJobItem_itemId_idx" ON "PrintJobItem"("itemId");

-- CreateIndex
CREATE INDEX "ItemHistory_timestamp_idx" ON "ItemHistory"("timestamp");

-- CreateIndex
CREATE INDEX "Payout_paidAt_idx" ON "Payout"("paidAt");

-- Backfill: tags printed before print queues existed were only recorded as one
-- PRINT_TAG audit entry per item. Turn each into a one-tag PrintJob so Reports > Day
-- Detail / Print Queues show them too. The snapshot uses the item's current values
-- (what was actually on the tag wasn't recorded); a deleted item keeps only its SKU.
INSERT INTO "PrintJob" ("id", "storeId", "createdAt", "createdById", "activeRole", "source", "itemCount")
SELECT 'pj_' || a."id",
       COALESCE(i."storeId", (SELECT s."id" FROM "Store" s ORDER BY s."createdAt" LIMIT 1)),
       a."timestamp", a."performedById", a."activeRole", 'INTAKE', 1
FROM "AuditLog" a
LEFT JOIN "Item" i ON i."id" = a."entityId"
WHERE a."action" = 'PRINT_TAG' AND EXISTS (SELECT 1 FROM "Store");

INSERT INTO "PrintJobItem" ("id", "printJobId", "position", "itemId", "sku", "description", "price", "category", "size")
SELECT 'pji_' || a."id", 'pj_' || a."id", 0, i."id",
       COALESCE(i."sku", json_extract(a."details", '$.sku'), '?'),
       COALESCE(i."description", '(deleted item)'), COALESCE(i."price", 0), i."category", i."size"
FROM "AuditLog" a
LEFT JOIN "Item" i ON i."id" = a."entityId"
WHERE a."action" = 'PRINT_TAG' AND EXISTS (SELECT 1 FROM "Store");
