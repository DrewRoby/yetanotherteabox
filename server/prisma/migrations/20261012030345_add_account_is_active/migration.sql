-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Account" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "storeId" TEXT NOT NULL,
    "accountType" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "paymentMethod" TEXT,
    "mailingAddress" TEXT,
    "splitPercent" INTEGER,
    "currentBalance" REAL NOT NULL DEFAULT 0,
    "isStoreAccount" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastSaleAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Account_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Account" ("accountType", "createdAt", "currentBalance", "email", "id", "isStoreAccount", "lastSaleAt", "mailingAddress", "name", "paymentMethod", "phone", "splitPercent", "storeId", "updatedAt") SELECT "accountType", "createdAt", "currentBalance", "email", "id", "isStoreAccount", "lastSaleAt", "mailingAddress", "name", "paymentMethod", "phone", "splitPercent", "storeId", "updatedAt" FROM "Account";
DROP TABLE "Account";
ALTER TABLE "new_Account" RENAME TO "Account";
CREATE INDEX "Account_storeId_accountType_idx" ON "Account"("storeId", "accountType");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
