/*
  Warnings:

  - Added the required column `itemNumber` to the `Item` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Item" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sku" TEXT NOT NULL,
    "itemNumber" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "subcategory" TEXT,
    "brand" TEXT,
    "style" TEXT,
    "pattern" TEXT,
    "size" TEXT,
    "serialNumber" TEXT,
    "condition" TEXT,
    "consignmentType" TEXT,
    "status" TEXT NOT NULL DEFAULT 'AVAILABLE',
    "intakeDate" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "priceQuickSale" REAL,
    "price" REAL NOT NULL,
    "pricePremium" REAL,
    "cost" REAL,
    "accountId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Item_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Item_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
-- Backfill itemNumber per store, chronological by intake order, so existing rows
-- get the same sequential numbering a fresh intake would have assigned them.
INSERT INTO "new_Item" ("accountId", "brand", "category", "condition", "consignmentType", "cost", "createdAt", "description", "id", "intakeDate", "itemNumber", "pattern", "price", "pricePremium", "priceQuickSale", "serialNumber", "size", "sku", "status", "storeId", "style", "subcategory", "updatedAt")
SELECT "accountId", "brand", "category", "condition", "consignmentType", "cost", "createdAt", "description", "id", "intakeDate",
  ROW_NUMBER() OVER (PARTITION BY "storeId" ORDER BY "intakeDate", "id"),
  "pattern", "price", "pricePremium", "priceQuickSale", "serialNumber", "size", "sku", "status", "storeId", "style", "subcategory", "updatedAt"
FROM "Item";
DROP TABLE "Item";
ALTER TABLE "new_Item" RENAME TO "Item";
CREATE UNIQUE INDEX "Item_sku_key" ON "Item"("sku");
CREATE INDEX "Item_storeId_status_idx" ON "Item"("storeId", "status");
CREATE INDEX "Item_accountId_idx" ON "Item"("accountId");
CREATE UNIQUE INDEX "Item_storeId_itemNumber_key" ON "Item"("storeId", "itemNumber");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
