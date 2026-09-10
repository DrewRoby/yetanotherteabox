import { prisma } from "../lib/prisma";
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
  return account.id;
}

export class IntakeAccountError extends Error {}

export async function generateSku(category: string): Promise<string> {
  const prefix = category.slice(0, 3).toUpperCase().padEnd(3, "X");
  const count = await prisma.item.count();
  const suffix = (1000 + count + Math.floor(Math.random() * 89)).toString();
  return `${prefix}-${suffix}`;
}

export async function ensureStoreAccountSeeded(storeId: string) {
  return getOrCreateStoreAccount(storeId);
}
