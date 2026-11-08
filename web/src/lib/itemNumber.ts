// The item number staff read off the tag and type into search boxes: "<account#>-<item#>",
// e.g. "4545-12" (Liberty's ACCOUNT-ITEM_NUM convention — see Item.tagAccountNumber /
// accountItemNumber in server/prisma/schema.prisma). The barcode still encodes the SKU;
// an item with no tag number (some migrated store-owned stock) shows its SKU instead.
export interface ItemNumbered {
  sku: string;
  tagAccountNumber?: number | null;
  accountItemNumber?: number | null;
  tagNumber?: string | null; // print-job snapshots carry it pre-formatted
}

export function itemNo(item: ItemNumbered): string {
  if (item.tagNumber) return item.tagNumber;
  if (item.tagAccountNumber != null && item.accountItemNumber != null) return `${item.tagAccountNumber}-${item.accountItemNumber}`;
  return item.sku;
}

// Account header / picker label: "Abby Dudley - 123456".
export function accountLabel(account: { name: string; accountNumber?: number | null }): string {
  return account.accountNumber != null ? `${account.name} - ${account.accountNumber}` : account.name;
}
