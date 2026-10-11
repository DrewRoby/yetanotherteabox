/*
  Warnings:

  - Added the required column `payoutNumber` to the `Payout` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Payout" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "payoutNumber" INTEGER NOT NULL,
    "accountId" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" DATETIME,
    CONSTRAINT "Payout_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
-- Backfill payoutNumber chronologically (same approach as the add_item_number
-- migration). A migration from another system should set its own numbers instead.
INSERT INTO "new_Payout" ("accountId", "amount", "createdAt", "id", "paidAt", "payoutNumber", "status")
SELECT "accountId", "amount", "createdAt", "id", "paidAt", ROW_NUMBER() OVER (ORDER BY "createdAt", "id"), "status" FROM "Payout";
DROP TABLE "Payout";
ALTER TABLE "new_Payout" RENAME TO "Payout";
CREATE UNIQUE INDEX "Payout_payoutNumber_key" ON "Payout"("payoutNumber");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
