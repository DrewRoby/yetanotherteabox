-- Consignment expiry and store acquisition (2026-11-08). Store.autoDonate turns on
-- automatic donation of consignments unsold after 90 days (src/services/expiry.service.ts);
-- Item.donatedAt / flippedAt record when an item was donated, and when an expired
-- consignment was flipped to store inventory instead.

-- AlterTable
ALTER TABLE "Store" ADD COLUMN "autoDonate" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Item" ADD COLUMN "donatedAt" DATETIME;
ALTER TABLE "Item" ADD COLUMN "flippedAt" DATETIME;
