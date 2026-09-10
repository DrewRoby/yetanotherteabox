// Typed readers against the restored Liberty SQL Server database. Column choices and
// the crosswalks that use this data are documented in
// ../../sql_server_data_model_migration_spec.md §3.1 — read that before changing
// any query here.
import { getPool } from "./db";

export interface LibertyStoreRow {
  STORE_NAME: string | null;
  ADDRESS_1: string | null;
  CITY: string | null;
  STATE: string | null;
}

export async function fetchStore(): Promise<LibertyStoreRow> {
  const pool = await getPool();
  const result = await pool.request().query(`SELECT TOP 1 STORE_NAME, ADDRESS_1, CITY, STATE FROM STORE;`);
  return result.recordset[0];
}

export interface LibertyClientRow {
  CLIENT_ID: number;
  CLIENT_TYPE_ID: number;
  FIRST_NAME: string | null;
  LAST_NAME: string | null;
  COMPANY_NAME: string | null;
  DEF_PRICE_CODE_ID: number | null;
  PAYMENT_ACT_ID: number | null;
}

// CLIENT_TYPE_ID 1 = "Client" (-> CONSIGNOR), 2 = "Retail Vendor" (-> VENDOR).
// CLIENT_TYPE_ID 3 ("Store Account") is excluded — see client_type_3_review.md,
// pending the shop owner's sort. CLIENT_ID 101508 is excluded — corrupted ledger
// balance (~$2B), see spec §3.1.
export async function fetchOrdinaryClients(): Promise<LibertyClientRow[]> {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT CLIENT_ID, CLIENT_TYPE_ID, FIRST_NAME, LAST_NAME, COMPANY_NAME,
           DEF_PRICE_CODE_ID, PAYMENT_ACT_ID
    FROM CLIENT
    WHERE CLIENT_TYPE_ID IN (1, 2) AND CLIENT_ID <> 101508;
  `);
  return result.recordset;
}

export interface AddressRow {
  CLIENT_ID: number;
  ADDRESS_1: string | null;
  ADDRESS_2: string | null;
  CITY: string | null;
  STATE: string | null;
  ZIP: string | null;
}

export async function fetchPrimaryAddresses(): Promise<AddressRow[]> {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT CLIENT_ID, ADDRESS_1, ADDRESS_2, CITY, STATE, ZIP
    FROM ADDRESS WHERE PRIMARY_IND = 1;
  `);
  return result.recordset;
}

export async function fetchPrimaryPhones(): Promise<{ CLIENT_ID: number; PHONE_NUMBER: string | null }[]> {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT CLIENT_ID, PHONE_NUMBER FROM PHONE WHERE PRIMARY_IND = 1;
  `);
  return result.recordset;
}

export async function fetchPrimaryEmails(): Promise<{ CLIENT_ID: number; EMAIL_ADDR: string | null }[]> {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT CLIENT_ID, EMAIL_ADDR FROM EMAIL WHERE PRIMARY_IND = 1;
  `);
  return result.recordset;
}

export async function fetchPriceCodeStorePct(): Promise<{ PRICE_CODE_ID: number; STORE_PCT: number | null }[]> {
  const pool = await getPool();
  const result = await pool.request().query(`SELECT PRICE_CODE_ID, STORE_PCT FROM PRICE_CODE;`);
  return result.recordset;
}

export async function fetchPaymentActs(): Promise<{ PAYMENT_ACT_ID: number; BANK_NAME: string | null }[]> {
  const pool = await getPool();
  const result = await pool.request().query(`SELECT PAYMENT_ACT_ID, BANK_NAME FROM PAYMENT_ACT;`);
  return result.recordset;
}

// Balance formula per spec §3.1: SUM(ACT_TRANS_AMT) restricted to TRANS_CD.PAYABLE_IND = 1
// (excludes -1 = pending/pay-delayed, 0 = non-cash e.g. trade/store-credit buckets).
export async function fetchClientBalances(): Promise<{ CLIENT_ID: number; balance: number }[]> {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT ct.CLIENT_ID, SUM(ct.ACT_TRANS_AMT) AS balance
    FROM CLIENT_TRANS ct
    JOIN TRANS_CD tc ON ct.TRANS_CD_ID = tc.TRANS_CD_ID
    WHERE tc.PAYABLE_IND = 1
    GROUP BY ct.CLIENT_ID;
  `);
  return result.recordset;
}

// Clean 1:1 join (verified: COUNT(*) = COUNT(DISTINCT ITEM_ID)) — presence means
// consigned to CLIENT_ID; absence means store-owned. See spec §3.1 on why
// ITEM.ITEM_ACQUISITION_TYPE_ID can't be used for this instead.
export async function fetchClientItemLinks(): Promise<{ ITEM_ID: number; CLIENT_ID: number }[]> {
  const pool = await getPool();
  const result = await pool.request().query(`SELECT ITEM_ID, CLIENT_ID FROM CLIENT_ITEM;`);
  return result.recordset;
}

export interface CategoryListRow {
  CATEGORY_LIST_ID: number;
  CAT_L1_NAME: string;
  CAT_L3_NAME: string | null;
}

export async function fetchCategoryList(): Promise<CategoryListRow[]> {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT CATEGORY_LIST_ID, CAT_L1_NAME, CAT_L3_NAME FROM CATEGORY_LIST;
  `);
  return result.recordset;
}

export interface CategoryRow {
  CATEGORY_ID: number;
  CATEGORY_NAME: string;
}

// Fallback for ITEM.CATEGORY_ID values that don't match a CATEGORY_LIST leaf id.
export async function fetchCategories(): Promise<CategoryRow[]> {
  const pool = await getPool();
  const result = await pool.request().query(`SELECT CATEGORY_ID, CATEGORY_NAME FROM CATEGORY;`);
  return result.recordset;
}

// Brand/Size account for 99.9% of ITEM_ATTR rows (spec §3.1) — everything else is
// noise not worth a bespoke crosswalk.
export async function fetchBrandSizeAttrs(): Promise<{ ITEM_ID: number; ATTR_TYPE_DESC: string; ATTR_TYPE_VALUE: string | null }[]> {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT ia.ITEM_ID, at.ATTR_TYPE_DESC, atv.ATTR_TYPE_VALUE
    FROM ITEM_ATTR ia
    JOIN CAT_ATTR ca ON ia.CAT_ATTR_ID = ca.CAT_ATTR_ID
    JOIN ATTR_TYPE at ON ca.ATTR_TYPE_ID = at.ATTR_TYPE_ID
    JOIN ATTR_TYPE_VALUE atv ON ia.ATTR_TYPE_VALUE_ID = atv.ATTR_TYPE_VALUE_ID
    WHERE at.ATTR_TYPE_DESC LIKE '%Brand%' OR at.ATTR_TYPE_DESC LIKE '%Size%';
  `);
  return result.recordset;
}

export interface LibertyItemRow {
  ITEM_ID: number;
  ITEM_NUM: number;
  CATEGORY_ID: number | null;
  STATUS_ID: number;
  ITEM_ACQUISITION_TYPE_ID: number;
  ITEM_NAME: string | null;
  ITEM_DESC: string | null;
  RECEIVE_TS: Date;
  PRICE: number | null;
  COST: number | null;
  SALE_DETAIL_ID: number | null;
}

export async function fetchItems(): Promise<LibertyItemRow[]> {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT ITEM_ID, ITEM_NUM, CATEGORY_ID, STATUS_ID, ITEM_ACQUISITION_TYPE_ID,
           ITEM_NAME, ITEM_DESC, RECEIVE_TS, PRICE, COST, SALE_DETAIL_ID
    FROM ITEM;
  `);
  return result.recordset;
}

export interface ItemStatusRow {
  STATUS_ID: number;
  STATUS_DESC: string;
}

export async function fetchItemStatuses(): Promise<ItemStatusRow[]> {
  const pool = await getPool();
  const result = await pool.request().query(`SELECT STATUS_ID, STATUS_DESC FROM ITEM_STATUS;`);
  return result.recordset;
}

export interface SaleDetailRow {
  SALE_DETAIL_ID: number;
  SALE_ID: number;
  ITEM_ID: number;
  PRICE_SOLD: number;
  SALE_TS: Date;
}

// SALE_DETAIL_TYPE_ID = 1 is "Inventory" (an actual item line) — other types
// (Layaway Payment, Gift Card, Delivery, etc.) have no Item to attach to.
export async function fetchInventorySaleDetails(): Promise<SaleDetailRow[]> {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT SALE_DETAIL_ID, SALE_ID, ITEM_ID, PRICE_SOLD, SALE_TS
    FROM SALE_DETAIL
    WHERE SALE_DETAIL_TYPE_ID = 1 AND ITEM_ID IS NOT NULL;
  `);
  return result.recordset;
}

// One row per SALE_ID (MIN(PAY_DTL_ID) as a deterministic tiebreak for split-tender
// sales) — Teabox's Sale.paymentType is a single value per sale, not itemized.
export async function fetchPrimarySalePaymentTypes(): Promise<{ SALE_ID: number; PAYMENT_TYPE_ID: number }[]> {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT spd.SALE_ID, spd.PAYMENT_TYPE_ID
    FROM SALE_PAY_DTL spd
    WHERE spd.PAY_DTL_ID IN (
      SELECT MIN(PAY_DTL_ID) FROM SALE_PAY_DTL GROUP BY SALE_ID
    );
  `);
  return result.recordset;
}

export interface PayoutRow {
  PAYOUT_ID: number;
  CLIENT_ID: number;
  PAYMENT_ACT_ID: number;
  PAYOUT_TS: Date | null;
  PAYOUT_AMT: number | null;
  RECONCILE_STATUS: string | null;
}

export async function fetchPayouts(): Promise<PayoutRow[]> {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT PAYOUT_ID, CLIENT_ID, PAYMENT_ACT_ID, PAYOUT_TS, PAYOUT_AMT, RECONCILE_STATUS
    FROM PAYOUT
    WHERE CLIENT_ID <> 101508;
  `);
  return result.recordset;
}
