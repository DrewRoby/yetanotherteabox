import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { formatBarcode } from "../lib/barcode";
import { ACCOUNT_SCOPED_ROLES, type Role } from "../lib/enums";
import type { SessionClaims } from "../lib/jwt";
import { getOrCreateStoreAccount } from "./accounts.service";

// Resolves which Account an intake operation targets, per app_flow_document.md:
//   - Consignor/Booth Owner sessions ALWAYS target their own linked account; any
//     accountId the client sends is ignored, not merely validated.
//   - Store-level sessions (Employee/Manager/Owner/Admin) MUST supply a valid
//     accountId belonging to the same store (the store's own STORE account is a
//     valid choice for store-owned inventory).
// This is the single choke point behind tasks 825fcb1e / 1a912596 / c3ec7969 — every
// route that creates an Item calls this instead of trusting the request body.
export async function resolveIntakeAccountId(
  session: SessionClaims,
  requestedAccountId: string | null | undefined
): Promise<string> {
  if (ACCOUNT_SCOPED_ROLES.includes(session.activeRole as Role)) {
    if (!session.accountId) {
      throw new IntakeAccountError("Session has no linked account to intake against");
    }
    const own = await prisma.account.findUnique({ where: { id: session.accountId }, select: { isActive: true } });
    if (!own?.isActive) {
      throw new IntakeAccountError("Your account is inactive — please ask the store to reactivate it");
    }
    return session.accountId;
  }

  if (!requestedAccountId) {
    throw new IntakeAccountError("An accountId is required for intake");
  }
  const account = await prisma.account.findFirst({
    where: { id: requestedAccountId, storeId: session.storeId },
  });
  if (!account) {
    throw new IntakeAccountError("accountId does not belong to this store");
  }
  // Inactive = dormant; new consignments mean it's active again, which should be a
  // deliberate reactivation on the account page rather than happen silently.
  if (!account.isActive) {
    throw new IntakeAccountError(`${account.name} is inactive — reactivate it on its account page first`);
  }
  return account.id;
}

export class IntakeAccountError extends Error {}

// The itemNumber + sku for a store's next new item: one past the store's highest
// itemNumber, but never below Store.itemStartNumber, with Store.itemPrefix. Because
// every SKU encodes its own item's number (formatBarcode), max + 1 can't collide with
// any existing SKU — under any prefix, including a migrated "LIB-" one — and lowering
// itemStartNumber later can't move numbering backwards. Call inside the same
// interactive transaction as the create: SQLite serializes writer transactions, so
// the read-then-create is race-free.
export async function nextItemIdentity(tx: Prisma.TransactionClient, storeId: string) {
  const store = await tx.store.findUniqueOrThrow({
    where: { id: storeId },
    select: { itemPrefix: true, itemStartNumber: true },
  });
  const { _max } = await tx.item.aggregate({ where: { storeId }, _max: { itemNumber: true } });
  const itemNumber = Math.max((_max.itemNumber ?? 0) + 1, store.itemStartNumber);
  return { itemNumber, sku: formatBarcode(store.itemPrefix, itemNumber) };
}

export async function ensureStoreAccountSeeded(storeId: string) {
  return getOrCreateStoreAccount(storeId);
}
