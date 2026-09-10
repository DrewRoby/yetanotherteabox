// Central definition of the string-backed "enums" stored in SQLite (see schema.prisma
// header comment). Keep these in sync with the Prisma field comments.

export const ROLES = [
  "SYSTEM_ADMIN",
  "OWNER",
  "MANAGER",
  "EMPLOYEE",
  "REGISTER",
  "CONSIGNOR",
  "VENDOR",
  "DONOR",
  "BOOTH_OWNER",
] as const;
export type Role = (typeof ROLES)[number];

// Roles that manage the store itself, as opposed to external parties transacting
// with the store. Used throughout to decide "does this session pick its own intake
// account, or must it choose one?" and similar branches.
export const STAFF_ROLES: Role[] = ["SYSTEM_ADMIN", "OWNER", "MANAGER", "EMPLOYEE"];
export const ACCOUNT_SCOPED_ROLES: Role[] = ["CONSIGNOR", "VENDOR", "DONOR", "BOOTH_OWNER"];

export const ACCOUNT_TYPES = ["CONSIGNOR", "VENDOR", "DONOR", "BOOTH_OWNER", "STORE"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

// Donor accounts are never owed money — enforced wherever balances/payouts render or post.
export const BALANCE_BEARING_ACCOUNT_TYPES: AccountType[] = ["CONSIGNOR", "VENDOR", "BOOTH_OWNER"];

export const ITEM_STATUSES = ["PENDING", "AVAILABLE", "SOLD", "DONATED", "DISPOSED", "RETURNED"] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

export const PAYOUT_STATUSES = ["REQUESTED", "APPROVED", "PAID", "REJECTED"] as const;
export type PayoutStatus = (typeof PAYOUT_STATUSES)[number];

export function roleToAccountType(role: Role): AccountType | null {
  switch (role) {
    case "CONSIGNOR":
      return "CONSIGNOR";
    case "VENDOR":
      return "VENDOR";
    case "DONOR":
      return "DONOR";
    case "BOOTH_OWNER":
      return "BOOTH_OWNER";
    default:
      return null;
  }
}
