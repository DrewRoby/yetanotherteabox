-- HOLDING accounts (Lost & Found): items whose real owner isn't known yet. A sale
-- credits nobody; staff later claim the item for its owner's account, which is
-- credited then (src/services/accounts.service.ts claimHeldItems). claimedAt records
-- when, so the owner's next payout itemizes a claimed sale even if the sale itself
-- predates their latest payout.

-- AlterTable
ALTER TABLE "Item" ADD COLUMN "claimedAt" DATETIME;
