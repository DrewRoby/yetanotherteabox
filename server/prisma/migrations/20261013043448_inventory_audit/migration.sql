-- AlterTable
ALTER TABLE "Account" ADD COLUMN "legacyId" TEXT;

-- AlterTable
ALTER TABLE "Item" ADD COLUMN "auditAppliedAt" DATETIME;
ALTER TABLE "Item" ADD COLUMN "auditLabel" TEXT;
ALTER TABLE "Item" ADD COLUMN "auditLabeledAt" DATETIME;
ALTER TABLE "Item" ADD COLUMN "auditLabeledById" TEXT;
ALTER TABLE "Item" ADD COLUMN "consignorPercent" INTEGER;
ALTER TABLE "Item" ADD COLUMN "donateIfUnsold" BOOLEAN;
ALTER TABLE "Item" ADD COLUMN "tagPrintedAt" DATETIME;

-- AlterTable
ALTER TABLE "Payout" ADD COLUMN "checkNumber" TEXT;
ALTER TABLE "Payout" ADD COLUMN "method" TEXT;

-- CreateIndex
CREATE INDEX "Account_legacyId_idx" ON "Account"("legacyId");

-- CreateIndex
CREATE INDEX "Item_storeId_auditLabel_idx" ON "Item"("storeId", "auditLabel");

-- Backfill: items tag-printed through Teabox (print queues) get their latest print time.
-- Migrated items get Liberty's TAG_PRINTED_TS from liberty-etl's repair-ledger script.
UPDATE "Item" SET "tagPrintedAt" = (
  SELECT MAX(pj."createdAt") FROM "PrintJobItem" pji JOIN "PrintJob" pj ON pj."id" = pji."printJobId"
  WHERE pji."itemId" = "Item"."id"
) WHERE "id" IN (SELECT "itemId" FROM "PrintJobItem" WHERE "itemId" IS NOT NULL);
