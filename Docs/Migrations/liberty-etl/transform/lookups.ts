// Lookup maps the account/item transforms need, built from the raw extracts. Shared by
// scripts/migrate.ts (first load) and scripts/sync.ts (catch-up) so both build a new
// Account or Item from a Liberty row in exactly the same way.
import type {
  AddressRow,
  CategoryListRow,
  CategoryRow,
  ItemStatusRow,
} from "../extract/liberty";
import type { AccountLookups } from "./account";
import type { ItemLookups } from "./item";

export function buildAccountLookups(src: {
  addresses: AddressRow[];
  phones: { CLIENT_ID: number; PHONE_NUMBER: string | null }[];
  emails: { CLIENT_ID: number; EMAIL_ADDR: string | null }[];
  priceCodes: { PRICE_CODE_ID: number; STORE_PCT: number | null }[];
  paymentActs: { PAYMENT_ACT_ID: number; BANK_NAME: string | null }[];
  balances: { CLIENT_ID: number; balance: number }[];
}): AccountLookups {
  return {
    addressByClientId: new Map(src.addresses.map((a) => [a.CLIENT_ID, a])),
    phoneByClientId: new Map(src.phones.map((p) => [p.CLIENT_ID, p.PHONE_NUMBER])),
    emailByClientId: new Map(src.emails.map((e) => [e.CLIENT_ID, e.EMAIL_ADDR])),
    storePctByPriceCodeId: new Map(src.priceCodes.map((p) => [p.PRICE_CODE_ID, p.STORE_PCT])),
    paymentActNameById: new Map(src.paymentActs.map((p) => [p.PAYMENT_ACT_ID, p.BANK_NAME])),
    balanceByClientId: new Map(src.balances.map((b) => [b.CLIENT_ID, b.balance])),
  };
}

export function buildItemLookups(src: {
  itemStatuses: ItemStatusRow[];
  categoryList: CategoryListRow[];
  categories: CategoryRow[];
  brandSizeAttrs: { ITEM_ID: number; ATTR_TYPE_DESC: string; ATTR_TYPE_VALUE: string | null }[];
  clientItemLinks: { ITEM_ID: number; CLIENT_ID: number }[];
}): ItemLookups {
  return {
    itemStatusDescById: new Map(src.itemStatuses.map((s) => [s.STATUS_ID, s.STATUS_DESC])),
    categoryByCategoryListId: new Map(
      src.categoryList.map((c) => [c.CATEGORY_LIST_ID, { category: c.CAT_L1_NAME, subcategory: c.CAT_L3_NAME }])
    ),
    categoryNameById: new Map(src.categories.map((c) => [c.CATEGORY_ID, c.CATEGORY_NAME])),
    brandByItemId: new Map(
      src.brandSizeAttrs.filter((a) => a.ATTR_TYPE_DESC.includes("Brand") && a.ATTR_TYPE_VALUE).map((a) => [a.ITEM_ID, a.ATTR_TYPE_VALUE!])
    ),
    sizeByItemId: new Map(
      src.brandSizeAttrs.filter((a) => a.ATTR_TYPE_DESC.includes("Size") && a.ATTR_TYPE_VALUE).map((a) => [a.ITEM_ID, a.ATTR_TYPE_VALUE!])
    ),
    ownerClientIdByItemId: new Map(src.clientItemLinks.map((l) => [l.ITEM_ID, l.CLIENT_ID])),
  };
}
