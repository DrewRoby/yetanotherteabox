// Loads and validates config/store.yaml — see that file's header comment for what it
// drives. Kept deliberately simple (no schema-validation library): this is a
// one-time migration tool, not shipped product code, and the shape is small.
import * as fs from "fs";
import * as path from "path";
import { parse } from "yaml";
import { ROLES, ACCOUNT_SCOPED_ROLES, Role } from "../../../../server/src/lib/enums";

export interface StaffRoleEntry {
  name: string;
  email: string;
  password: string;
}

export interface AccountScopedRoleEntry {
  name: string;
  email: string;
  password: string;
  account: string; // must match a migrated Account.name exactly
}

export interface StoreConfig {
  store: { name: string; location: string };
  // New Teabox items' tag numbering (Store.itemPrefix / itemStartNumber). "auto" =
  // the next round number above the source system's highest item number.
  items: { prefix?: string; startNumber?: number | "auto" };
  owner: { name: string; email: string; password: string };
  roles: Partial<Record<Role, (StaffRoleEntry | AccountScopedRoleEntry)[]>>;
}

function isAccountScoped(role: Role): boolean {
  return (ACCOUNT_SCOPED_ROLES as string[]).includes(role);
}

export function loadStoreConfig(configPath = path.join(__dirname, "store.yaml")): StoreConfig {
  const raw = parse(fs.readFileSync(configPath, "utf-8"));

  if (!raw?.store?.name || typeof raw.store.name !== "string") {
    throw new Error(`${configPath}: store.name is required`);
  }
  if (!raw?.owner?.name || !raw?.owner?.email) {
    throw new Error(`${configPath}: owner.name and owner.email are required`);
  }
  if (!raw?.owner?.password) {
    throw new Error(`${configPath}: owner.password is required (every account needs its login password set in this file)`);
  }

  const roles: StoreConfig["roles"] = {};
  for (const role of ROLES) {
    const entries = raw.roles?.[role] ?? [];
    if (!Array.isArray(entries)) {
      throw new Error(`${configPath}: roles.${role} must be a list`);
    }
    for (const entry of entries) {
      if (!entry.name || !entry.email) {
        throw new Error(`${configPath}: roles.${role} entry missing name/email: ${JSON.stringify(entry)}`);
      }
      if (!entry.password) {
        throw new Error(`${configPath}: roles.${role} entry for ${entry.email} is missing a password`);
      }
      if (isAccountScoped(role) && !entry.account) {
        throw new Error(
          `${configPath}: roles.${role} entry for ${entry.email} is account-scoped and needs an 'account' field`
        );
      }
    }
    roles[role] = entries;
  }

  const items: StoreConfig["items"] = {};
  if (raw.items?.prefix != null) {
    const prefix = String(raw.items.prefix).trim().toUpperCase();
    if (!/^[A-Z0-9]{1,8}$/.test(prefix)) throw new Error(`${configPath}: items.prefix must be 1–8 letters/digits`);
    items.prefix = prefix;
  }
  if (raw.items?.startNumber != null) {
    const start = raw.items.startNumber;
    if (start !== "auto" && !(Number.isInteger(start) && start > 0)) {
      throw new Error(`${configPath}: items.startNumber must be a positive whole number or "auto"`);
    }
    items.startNumber = start;
  }

  return {
    store: { name: raw.store.name.trim(), location: (raw.store.location ?? "").trim() },
    items,
    owner: { name: raw.owner.name.trim(), email: raw.owner.email.trim(), password: String(raw.owner.password) },
    roles,
  };
}
