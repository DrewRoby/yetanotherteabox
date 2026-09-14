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

// Optional, opt-in alternative to the manual Setup Wizard: if SETUP_STORE_NAME,
// SETUP_OWNER_NAME, SETUP_OWNER_EMAIL, and SETUP_OWNER_PASSWORD are all present in
// the environment (e.g. via config.env on the Windows test-deploy build — see
// config.env.example), complete setup with them automatically on a fresh (empty)
// database instead of waiting for someone to fill out the wizard in a browser. Meant
// for repeatable test deploys where you want the same known owner login every time
// without re-typing it. A partial set of these vars is almost certainly a typo, not
// an intentional partial config, so it's logged and skipped rather than guessing.
export async function maybeAutoCompleteSetup(): Promise<void> {
  if (!(await needsSetup())) return;

  const storeName = process.env.SETUP_STORE_NAME;
  const ownerName = process.env.SETUP_OWNER_NAME;
  const ownerEmail = process.env.SETUP_OWNER_EMAIL;
  const password = process.env.SETUP_OWNER_PASSWORD;
  const provided = [storeName, ownerName, ownerEmail, password];
  if (provided.every((v) => !v)) return; // none set — normal manual-wizard path

  if (provided.some((v) => !v)) {
    console.warn(
      "SETUP_STORE_NAME / SETUP_OWNER_NAME / SETUP_OWNER_EMAIL / SETUP_OWNER_PASSWORD must all be " +
        "set together to auto-complete setup — some are missing, so falling back to the manual Setup Wizard."
    );
    return;
  }

  try {
    await completeSetup({
      storeName: storeName!,
      storeLocation: process.env.SETUP_STORE_LOCATION,
      ownerName: ownerName!,
      ownerEmail: ownerEmail!,
      password: password!,
    });
    console.log(`Setup auto-completed from config: store "${storeName}", owner ${ownerEmail}.`);
  } catch (err) {
    console.error("Auto-setup from config failed; falling back to the manual Setup Wizard.", err);
  }
}
