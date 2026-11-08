-- AlterTable
ALTER TABLE "Account" ADD COLUMN "accountNumber" INTEGER;
ALTER TABLE "Account" ADD COLUMN "nextItemNumber" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "Item" ADD COLUMN "tagAccountNumber" INTEGER;
ALTER TABLE "Item" ADD COLUMN "accountItemNumber" INTEGER;

-- AlterTable
ALTER TABLE "PrintJobItem" ADD COLUMN "tagNumber" TEXT;

-- Backfill: number every existing account 1..N per store, oldest first. A database
-- migrated from Liberty gets Liberty's own numbers (CLIENT.ACCOUNT) from liberty-etl's
-- `npm run backfill-tag-numbers`, which replaces these.
UPDATE "Account" SET "accountNumber" = (
  SELECT n FROM (
    SELECT "id", ROW_NUMBER() OVER (PARTITION BY "storeId" ORDER BY "createdAt", "id") AS n FROM "Account"
  ) r WHERE r."id" = "Account"."id"
);

-- Backfill: Teabox-native items (not migrated "LIB-" ones, whose numbers come from
-- Liberty via backfill-tag-numbers) get "<account#>-<1..n>" in intake order.
UPDATE "Item" SET
  "tagAccountNumber" = (SELECT a."accountNumber" FROM "Account" a WHERE a."id" = "Item"."accountId"),
  "accountItemNumber" = (
    SELECT n FROM (
      SELECT "id", ROW_NUMBER() OVER (PARTITION BY "accountId" ORDER BY "itemNumber") AS n
      FROM "Item" WHERE "sku" NOT LIKE 'LIB-%'
    ) r WHERE r."id" = "Item"."id"
  )
WHERE "sku" NOT LIKE 'LIB-%';

UPDATE "Account" SET "nextItemNumber" = 1 + COALESCE(
  (SELECT MAX(i."accountItemNumber") FROM "Item" i WHERE i."accountId" = "Account"."id"), 0
);

-- CreateIndex
CREATE UNIQUE INDEX "Account_storeId_accountNumber_key" ON "Account"("storeId", "accountNumber");

-- CreateIndex
CREATE INDEX "Item_storeId_tagAccountNumber_accountItemNumber_idx" ON "Item"("storeId", "tagAccountNumber", "accountItemNumber");
