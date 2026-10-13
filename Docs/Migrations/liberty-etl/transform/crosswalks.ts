// Enum crosswalks confirmed in ../../sql_server_data_model_migration_spec.md §3.1.
// Keep these two files in sync — this is the code form of that table.

const ITEM_STATUS_DESC_TO_TEABOX: Record<string, string> = {
  Available: "AVAILABLE",
  Sold: "SOLD",
  "Sold Online": "SOLD",
  Donated: "DONATED",
  Returned: "RETURNED",
  Void: "DISPOSED",
  Expired: "DISPOSED",
  "Item Lost": "DISPOSED",
  Unavailable: "DISPOSED",
  // Everything else (Needs Info, Print Labels, Being Sold, Ordered Online,
  // Shipper Data Required, Package Info Required, Contact Shipper, Layaway, Other)
  // is ambiguous/in-flux — falls through to the PENDING default below. Per spec §5,
  // never default an ambiguous source status to AVAILABLE.
};

// ITEM.STATUS_ID is dominated by "Unavailable" (97% of all items in this shop's real
// data) and 99.6% of THOSE have a populated SALE_DETAIL_ID — i.e. "Unavailable" is
// Liberty's generic "off the floor" catch-all applied on sale, not a real disposition
// signal by itself. Same trap as ITEM_ACQUISITION_TYPE_ID (spec §3.1): check
// SALE_DETAIL_ID first, and only fall back to the STATUS_DESC table below when there's
// no sale to key off. None of Donated/Returned/Expired/etc. actually appear as
// ITEM.STATUS_ID values in this shop's real data — the fallback exists for
// completeness/other shops, not because this shop uses it.
export function mapItemStatus(statusDesc: string, hasSaleDetailId: boolean): string {
  if (hasSaleDetailId) return "SOLD";
  return ITEM_STATUS_DESC_TO_TEABOX[statusDesc] ?? "PENDING";
}

// Liberty PAYMENT_TYPE_ID values seen in this shop's SALE_PAY_DTL are almost
// entirely cash or one card network — collapse everything onto Teabox's 3 values.
const CASH_PAYMENT_TYPE_IDS = new Set([1]); // "Cash"
const STORE_CREDIT_PAYMENT_TYPE_IDS = new Set([7, 16]); // Layaway Balance, Store Credit (np)

export function mapPaymentType(paymentTypeId: number): string {
  if (CASH_PAYMENT_TYPE_IDS.has(paymentTypeId)) return "CASH";
  if (STORE_CREDIT_PAYMENT_TYPE_IDS.has(paymentTypeId)) return "STORE_CREDIT";
  return "CARD";
}

// RECONCILE_STATUS has no lookup table backing it — this is a best guess pending the
// shop owner's confirmation (spec §9). P dominates (45,055 of 50,640 rows).
const RECONCILE_STATUS_TO_TEABOX: Record<string, string> = {
  P: "PAID", // Paid
  R: "PAID", // Reconciled
  // Not yet bank-reconciled. At Hidden Treasures every N payout is a *check* (P ones are
  // cash) — written and handed over, just never reconciled in Liberty — so it's paid.
  // (First load mapped this to REQUESTED; fixed in place by scripts/repair-ledger.ts.)
  N: "PAID",
  D: "REJECTED", // Deleted/voided
};

// PAYMENT_ACT_ID → Payout.method (1 Check, 2 Cash; 3 "Reconciliation" has no method).
export function mapPayoutMethod(paymentActId: number | null): string | null {
  if (paymentActId === 1) return "CHECK";
  if (paymentActId === 2) return "CASH";
  return null;
}

export function mapPayoutStatus(reconcileStatus: string | null): string {
  if (!reconcileStatus) return "REQUESTED";
  return RECONCILE_STATUS_TO_TEABOX[reconcileStatus] ?? "REQUESTED";
}

// ITEM_ACQUISITION_TYPE_ID is unreliable for Store-Owned(1)/Consign(3) — see spec
// §3.1 — but the Purchase(2)/Trade(4) values are genuinely set and meaningful.
export function mapConsignmentType(acquisitionTypeId: number): string | null {
  if (acquisitionTypeId === 2) return "Buy-Outright";
  if (acquisitionTypeId === 4) return "Trade";
  return null;
}

// TRANS_CD_ID -> Teabox PayoutLine.lineType (server/src/lib/enums.ts PAYOUT_LINE_TYPES).
// TRANS_CD is self-describing (spec §3.1); codes with zero rows in Hidden Treasures'
// data are mapped anyway by their name so another Liberty shop doesn't fall through.
const TRANS_CD_TO_LINE_TYPE: Record<number, string> = {
  1: "SALE", // Sold Item
  5: "SALE", // Sold Online
  2: "PURCHASE", // Purchased Item (store bought it outright from the client)
  11: "RETURN", // Return Sale
  3: "DEDUCTION", // Deduction
  16: "DEDUCTION", // Sale Deduction
  6: "FEE", // Listing Fee
  7: "FEE", // Check Fee
  14: "FEE", // Final Value Fee
  12: "ADVANCE", // Payment Advance
};

export function mapPayoutLineType(transCdId: number): string {
  return TRANS_CD_TO_LINE_TYPE[transCdId] ?? "ADJUSTMENT"; // Adjustment, Store Credit Purchase, Reconciliation, Forfeited Balance, ...
}
