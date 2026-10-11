-- AlterTable
ALTER TABLE "Item" ADD COLUMN "paidOutAt" DATETIME;
ALTER TABLE "Item" ADD COLUMN "soldAt" DATETIME;

-- Backfill (before the indexes below exist, so the updates don't maintain them).
-- soldAt: latest sale. paidOutAt: latest non-REJECTED payout that itemized the item.
-- Same statements a data migration must run after inserting Sale/PayoutLine rows.
UPDATE "Item" SET "soldAt" = (SELECT MAX(s."saleDate") FROM "Sale" s WHERE s."itemId" = "Item"."id");
UPDATE "Item" SET "paidOutAt" = (
    SELECT MAX(COALESCE(p."paidAt", p."createdAt")) FROM "PayoutLine" l
    JOIN "Payout" p ON p."id" = l."payoutId"
    WHERE l."itemId" = "Item"."id" AND p."status" <> 'REJECTED'
);

-- CreateIndex
CREATE INDEX "Item_storeId_intakeDate_idx" ON "Item"("storeId", "intakeDate");

-- CreateIndex
CREATE INDEX "Item_storeId_soldAt_idx" ON "Item"("storeId", "soldAt");

-- CreateIndex
CREATE INDEX "Item_storeId_paidOutAt_idx" ON "Item"("storeId", "paidOutAt");

-- CreateIndex
CREATE INDEX "Item_storeId_category_idx" ON "Item"("storeId", "category");
