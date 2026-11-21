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

// HOLDING = a Lost & Found-style account: goods dropped off by someone who has (or
// will have) an account of their own but didn't mark them. Its items sell normally,
// but a sale credits nobody and the account is never paid out; staff claim each item
// for its real owner, who is credited then (claimHeldItems in
// services/accounts.service.ts). No login role maps to it.
export const ACCOUNT_TYPES = ["CONSIGNOR", "VENDOR", "DONOR", "BOOTH_OWNER", "STORE", "HOLDING"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

// Donor accounts are never owed money — enforced wherever balances/payouts render or post.
// HOLDING isn't either: its sales are owed to whoever claims them, not to the account.
export const BALANCE_BEARING_ACCOUNT_TYPES: AccountType[] = ["CONSIGNOR", "VENDOR", "BOOTH_OWNER"];

export const ITEM_STATUSES = ["PENDING", "AVAILABLE", "SOLD", "DONATED", "DISPOSED", "RETURNED"] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

export const PAYOUT_STATUSES = ["REQUESTED", "APPROVED", "PAID", "REJECTED"] as const;
export type PayoutStatus = (typeof PAYOUT_STATUSES)[number];

// PayoutLine.lineType. SALE/PURCHASE carry an itemId; the rest are account-level
// adjustments. ADJUSTMENT also covers any part of a payout amount not attributable to
// specific sales (e.g. a balance carried over from a migrated system).
export const PAYOUT_LINE_TYPES = ["SALE", "PURCHASE", "RETURN", "DEDUCTION", "FEE", "ADVANCE", "ADJUSTMENT"] as const;
export type PayoutLineType = (typeof PAYOUT_LINE_TYPES)[number];

// Item.consignmentType — how the store came to own a store-owned item (null on a
// consigned item, or where nobody recorded it). "Buy-Outright" and "Trade" are the
// values liberty-etl already migrates (Liberty ITEM_ACQUISITION_TYPE Purchase/Trade);
// "Buy-Outright" covers any purchase — from a person, a vendor or a closeout lot.
// "Walk-in Donation" = goods left by someone who didn't want an account. "Expired
// Consignment" = a consignment flipped to store inventory (Item.flippedAt) — set by
// the flip, not chosen at intake.
export const CONSIGNMENT_TYPES = ["Buy-Outright", "Trade", "Walk-in Donation", "Expired Consignment"] as const;
export type ConsignmentType = (typeof CONSIGNMENT_TYPES)[number];
export const INTAKE_CONSIGNMENT_TYPES: ConsignmentType[] = ["Buy-Outright", "Trade", "Walk-in Donation"];

// Hidden Treasures' consignment period: unsold after this many days, a consignment is
// the store's to donate (Store.autoDonate) or keep (flip to store inventory).
export const CONSIGNMENT_DAYS = 90;

// Item.auditLabel —Inventory Audit classifications (src/services/inventoryAudit.service.ts).
// Applying a label: KEEP → nothing; EXPIRED_TO_STORE → item moves to the store's own
// account; DONATE → DONATED; RETURN → RETURNED; WRITE_OFF → DISPOSED.
export const AUDIT_LABELS = ["KEEP", "EXPIRED_TO_STORE", "DONATE", "RETURN", "WRITE_OFF"] as const;
export type AuditLabel = (typeof AUDIT_LABELS)[number];

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
