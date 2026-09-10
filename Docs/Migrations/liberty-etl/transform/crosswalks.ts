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
  N: "REQUESTED", // Not yet reconciled
  D: "REJECTED", // Deleted/voided
};

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
