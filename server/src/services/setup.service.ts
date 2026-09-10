import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma";
import { beginSession } from "./auth.service";
import { getOrCreateStoreAccount } from "./accounts.service";

export async function needsSetup(): Promise<boolean> {
  const storeCount = await prisma.store.count();
  return storeCount === 0;
}

export interface CompleteSetupInput {
  storeName: string;
  storeLocation?: string;
  ownerName: string;
  ownerEmail: string;
  password: string;
}

// One-time bootstrap for a brand-new deployment: creates the store, its owner
// account, and the store's own STORE-type inventory account (the same helper intake
// relies on — see items.service.ts's resolveIntakeAccountId), then signs the owner
// straight into a session. Deliberately creates NO demo data — a real shop starts
// empty; prisma/seed.ts remains the separate path for local dev/demo data.
export async function completeSetup(input: CompleteSetupInput) {
  if (!(await needsSetup())) {
    throw new SetupAlreadyCompleteError();
  }

  const passwordHash = await bcrypt.hash(input.password, 10);

  const store = await prisma.store.create({
    data: { name: input.storeName, location: input.storeLocation },
  });
  await getOrCreateStoreAccount(store.id);

  const user = await prisma.user.create({
    data: { email: input.ownerEmail, name: input.ownerName, passwordHash },
  });
  await prisma.userRole.create({ data: { userId: user.id, role: "OWNER", storeId: store.id } });

  const session = await beginSession(user.id);
  if (session.needsRoleSelection) {
    // Unreachable in practice (a brand-new user has exactly one role), but keeps the
    // return type honest rather than asserting past it.
    throw new Error("Unexpected role selection required for a freshly created owner");
  }
  return { token: session.token, storeId: store.id, userId: user.id };
}

export class SetupAlreadyCompleteError extends Error {
  constructor() {
    super("Setup has already been completed for this deployment");
  }
}
