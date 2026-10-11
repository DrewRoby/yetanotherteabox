-- CreateIndex
CREATE INDEX "Item_accountId_intakeDate_idx" ON "Item"("accountId", "intakeDate");

-- CreateIndex
CREATE INDEX "Item_accountId_soldAt_idx" ON "Item"("accountId", "soldAt");

-- CreateIndex
CREATE INDEX "Item_accountId_paidOutAt_idx" ON "Item"("accountId", "paidOutAt");
