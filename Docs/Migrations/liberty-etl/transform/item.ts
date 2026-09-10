import type { LibertyItemRow } from "../extract/liberty";
import { mapConsignmentType, mapItemStatus } from "./crosswalks";

export interface ItemLookups {
  itemStatusDescById: Map<number, string>;
  categoryByCategoryListId: Map<number, { category: string; subcategory: string | null }>;
  categoryNameById: Map<number, string>;
  brandByItemId: Map<number, string>;
  sizeByItemId: Map<number, string>;
  // ITEM_ID -> CLIENT_ID, only for clients we're migrating in this batch (§3.1 —
  // CLIENT_TYPE_ID=3 accounts excluded pending the owner's review).
  ownerClientIdByItemId: Map<number, number>;
}

export interface TransformedItem {
  libertyItemId: number;
  sku: string;
  description: string;
  category: string;
  subcategory: string | null;
  brand: string | null;
  size: string | null;
  condition: string | null;
  consignmentType: string | null;
  status: string;
  intakeDate: Date;
  price: number;
  cost: number | null;
  ownerClientId: number | null; // null => store-owned
}

export function transformItem(item: LibertyItemRow, lookups: ItemLookups): TransformedItem {
  const statusDesc = lookups.itemStatusDescById.get(item.STATUS_ID) ?? "Other";
  const catByList = item.CATEGORY_ID != null ? lookups.categoryByCategoryListId.get(item.CATEGORY_ID) : undefined;
  const categoryName = catByList?.category ?? (item.CATEGORY_ID != null ? lookups.categoryNameById.get(item.CATEGORY_ID) : undefined);

  return {
    libertyItemId: item.ITEM_ID,
    sku: `LIB-${item.ITEM_ID}`,
    description: item.ITEM_DESC?.trim() || item.ITEM_NAME?.trim() || `Item ${item.ITEM_ID}`,
    category: categoryName ?? "Uncategorized",
    subcategory: catByList?.subcategory ?? null,
    brand: lookups.brandByItemId.get(item.ITEM_ID) ?? null,
    size: lookups.sizeByItemId.get(item.ITEM_ID) ?? null,
    condition: null,
    consignmentType: mapConsignmentType(item.ITEM_ACQUISITION_TYPE_ID),
    status: mapItemStatus(statusDesc, item.SALE_DETAIL_ID != null),
    intakeDate: item.RECEIVE_TS,
    price: item.PRICE ?? 0,
    cost: item.COST ?? null,
    ownerClientId: lookups.ownerClientIdByItemId.get(item.ITEM_ID) ?? null,
  };
}
