// Display vocabulary for the Inventory Audit — mirrors server/src/services/
// inventoryAudit.service.ts's DIMENSIONS keys/values and lib/enums.ts's AUDIT_LABELS.

export const DIMENSIONS = [
  { key: "expired", label: "Consignment" },
  { key: "age", label: "Age" },
  { key: "owner", label: "Owner" },
  { key: "accountStatus", label: "Account" },
  { key: "ownerLastSale", label: "Owner's Last Sale" },
  { key: "tagged", label: "Tag Printed" },
  { key: "donate", label: "Donate if Unsold" },
  { key: "split", label: "Consignor Split" },
  { key: "category", label: "Category" },
  { key: "price", label: "Price" },
  { key: "status", label: "Status" },
  { key: "label", label: "Audit Label" },
] as const;
export type Dimension = (typeof DIMENSIONS)[number]["key"];
export const DIMENSION_KEYS = DIMENSIONS.map((d) => d.key) as Dimension[];

const VALUE_LABELS: Partial<Record<Dimension, Record<string, string>>> = {
  age: { current: "Last 90 days", "90d-1y": "90 days – 1 year", "1-3y": "1 – 3 years", "3y+": "Over 3 years" },
  owner: {
    consigned: "Consigned",
    "consigned-0": "Consigned, 100% to store",
    "store-account": "Store account (e.g. yearly inventory)",
    store: "Store (built-in)",
  },
  expired: { expired: "Expired (unsold > 90 days)", "in-period": "In consignment period", "n/a": "Not consigned" },
  accountStatus: { active: "Active account", inactive: "Inactive account" },
  ownerLastSale: { "<1y": "Within a year", "1-3y": "1 – 3 years ago", "3y+": "Over 3 years ago", never: "Never" },
  tagged: { yes: "Tag printed", never: "Never tagged" },
  donate: { yes: "Yes", no: "No", unknown: "Unknown (Teabox intake)" },
};

export const AUDIT_LABELS = [
  { key: "KEEP", label: "Keep", tone: "bg-white", effect: "Nothing changes — marks the item as reviewed." },
  {
    key: "EXPIRED_TO_STORE",
    label: "Expired → Store",
    tone: "bg-gold",
    effect: "Moves each item to the store's own account. It stays on the floor; a sale credits no consignor.",
  },
  { key: "DONATE", label: "Donate", tone: "bg-bone", effect: "Sets status to Donated — off the floor." },
  {
    key: "RETURN",
    label: "Return",
    tone: "bg-bone",
    effect: "Sets status to Returned (to the consignor) — off the floor.",
  },
  {
    key: "WRITE_OFF",
    label: "Write Off",
    tone: "bg-ink text-white",
    effect: "Sets status to Disposed (missing / damaged) — off the floor.",
  },
] as const;
export type AuditLabelKey = (typeof AUDIT_LABELS)[number]["key"];

export function labelOf(key: string): string {
  return AUDIT_LABELS.find((l) => l.key === key)?.label ?? key;
}

// "EXPIRED_TO_STORE:applied" → "Expired → Store (applied)"
export function valueLabel(dim: Dimension, value: string): string {
  if (dim === "label") {
    if (value === "unlabeled") return "Unlabeled";
    const [key, applied] = value.split(":");
    return `${labelOf(key)}${applied ? " (applied)" : ""}`;
  }
  return VALUE_LABELS[dim]?.[value] ?? value;
}

export function dimensionLabel(dim: Dimension): string {
  return DIMENSIONS.find((d) => d.key === dim)?.label ?? dim;
}

export const money = (v: number) =>
  `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const money0 = (v: number) => `$${Math.round(v).toLocaleString()}`;
