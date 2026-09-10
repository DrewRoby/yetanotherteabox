// Shared User/UserRole application logic — used by both scripts/migrate.ts (fresh
// migration, where the Store/Accounts are being created in the same run) and
// scripts/add-users.ts (bulk-add against an already-migrated, already-running store).
// Idempotent by design, unlike migrate.ts as a whole: safe to run repeatedly against
// the same config/store.yaml — existing users/role-grants are left alone (or updated
// if an account-scoped grant's target account changed), never duplicated.
import * as crypto from "crypto";
import * as bcrypt from "bcryptjs";
import { ACCOUNT_SCOPED_ROLES } from "../../../../server/src/lib/enums";
import { StoreConfig, AccountScopedRoleEntry } from "../config/loadStoreConfig";
import { prisma } from "./prisma";

function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

export interface ApplyUsersResult {
  usersCreated: { email: string; name: string }[];
  rolesGranted: { email: string; role: string }[];
  rolesUpdated: { email: string; role: string }[]; // account-scoped grant re-pointed to a different account
  rolesUnchanged: { email: string; role: string }[];
  unmatchedAccounts: string[]; // "<role>/<email> -> \"<account name>\"" for account-scoped entries with no matching Account
}

// `accountIdByName` should cover every Account at this store, keyed by
// `name.trim().toLowerCase()` — including the STORE-type account, since an
// account-scoped role entry could legitimately point at it.
export async function applyUsersAndRoles(
  storeId: string,
  config: StoreConfig,
  accountIdByName: Map<string, string>
): Promise<ApplyUsersResult> {
  const result: ApplyUsersResult = {
    usersCreated: [],
    rolesGranted: [],
    rolesUpdated: [],
    rolesUnchanged: [],
    unmatchedAccounts: [],
  };

  const userCache = new Map<string, { id: string; email: string }>();

  async function ensureUser(name: string, email: string, password: string) {
    const key = email.trim().toLowerCase();
    const cached = userCache.get(key);
    if (cached) return cached;

    const existing = await prisma.user.findUnique({ where: { email: key } });
    if (existing) {
      const entry = { id: existing.id, email: key };
      userCache.set(key, entry);
      return entry;
    }

    // Password comes straight from config/store.yaml — see that file's header
    // comment for the tradeoff this accepts (a plaintext password sitting in a
    // config file) in exchange for not needing an out-of-band handoff step per
    // login on small deployments with no compliance requirement to avoid that.
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({ data: { id: newId("user"), email: key, name, passwordHash } });
    const entry = { id: user.id, email: key };
    userCache.set(key, entry);
    result.usersCreated.push({ email: key, name });
    return entry;
  }

  async function grantRole(user: { id: string; email: string }, role: string, accountId: string | null) {
    const existingGrant = await prisma.userRole.findUnique({
      where: { userId_role_storeId: { userId: user.id, role, storeId } },
    });
    if (existingGrant) {
      if (existingGrant.accountId !== accountId) {
        await prisma.userRole.update({ where: { id: existingGrant.id }, data: { accountId } });
        result.rolesUpdated.push({ email: user.email, role });
      } else {
        result.rolesUnchanged.push({ email: user.email, role });
      }
      return;
    }
    await prisma.userRole.create({ data: { id: newId("urole"), userId: user.id, role, storeId, accountId } });
    result.rolesGranted.push({ email: user.email, role });
  }

  // Owner (always OWNER) + any additional role grants from config.roles.
  const owner = await ensureUser(config.owner.name, config.owner.email, config.owner.password);
  await grantRole(owner, "OWNER", null);

  for (const role of Object.keys(config.roles) as (keyof typeof config.roles)[]) {
    const entries = config.roles[role] ?? [];
    const isAccountScoped = (ACCOUNT_SCOPED_ROLES as string[]).includes(role);
    for (const entry of entries) {
      const user = await ensureUser(entry.name, entry.email, entry.password);
      if (isAccountScoped) {
        const accountName = (entry as AccountScopedRoleEntry).account;
        const accountId = accountIdByName.get(accountName.trim().toLowerCase());
        if (!accountId) {
          result.unmatchedAccounts.push(`${role}/${entry.email} -> "${accountName}"`);
          continue;
        }
        await grantRole(user, role, accountId);
      } else {
        await grantRole(user, role, null);
      }
    }
  }

  return result;
}
