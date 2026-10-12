import type { LibertyClientRow } from "../extract/liberty";

interface AddressFields {
  ADDRESS_1: string | null;
  ADDRESS_2: string | null;
  CITY: string | null;
  STATE: string | null;
  ZIP: string | null;
}

export interface AccountLookups {
  addressByClientId: Map<number, AddressFields>;
  phoneByClientId: Map<number, string | null>;
  emailByClientId: Map<number, string | null>;
  storePctByPriceCodeId: Map<number, number | null>;
  paymentActNameById: Map<number, string | null>;
  balanceByClientId: Map<number, number>;
}

export interface TransformedAccount {
  libertyClientId: number;
  accountType: "CONSIGNOR" | "VENDOR";
  isStoreAccount: boolean;
  isActive: boolean;
  name: string;
  phone: string | null;
  email: string | null;
  mailingAddress: string | null;
  paymentMethod: string | null;
  splitPercent: number | null;
  currentBalance: number;
  createdAt: Date | null; // null => let the DB default (now) apply
}

function concatAddress(addr: AddressFields): string | null {
  const parts = [addr.ADDRESS_1, addr.ADDRESS_2, [addr.CITY, addr.STATE, addr.ZIP].filter(Boolean).join(", ")]
    .map((p) => p?.trim())
    .filter((p) => p && p.length > 0);
  return parts.length > 0 ? parts.join(", ") : null;
}

export function transformClientToAccount(client: LibertyClientRow, lookups: AccountLookups): TransformedAccount {
  const first = client.FIRST_NAME?.trim();
  const last = client.LAST_NAME?.trim();
  const company = client.COMPANY_NAME?.trim();
  const personName = [first, last].filter(Boolean).join(" ").trim();
  const name = personName || company || `Client ${client.CLIENT_ID}`;

  const addr = lookups.addressByClientId.get(client.CLIENT_ID);
  const mailingAddress = addr ? concatAddress(addr) : null;

  const storePct = client.DEF_PRICE_CODE_ID != null ? lookups.storePctByPriceCodeId.get(client.DEF_PRICE_CODE_ID) : null;
  const splitPercent = storePct != null ? 100 - storePct : null;

  const paymentActName = client.PAYMENT_ACT_ID != null ? lookups.paymentActNameById.get(client.PAYMENT_ACT_ID) : null;
  const paymentMethod = paymentActName ? JSON.stringify({ method: paymentActName }) : null;

  return {
    libertyClientId: client.CLIENT_ID,
    accountType: client.CLIENT_TYPE_ID === 2 ? "VENDOR" : "CONSIGNOR",
    // Liberty "Store Account" (type 3): the shop's own buckets (per-year "20XX
    // Inventory", "Hidden Treasures 2019", ...). Store-owned in Teabox: no balance.
    isStoreAccount: client.CLIENT_TYPE_ID === 3,
    // Liberty has no active flag, only timestamps: inactive = an INACTIVE_TS not
    // followed by a later ACTIVE_TS (reactivation). Barely used at Hidden Treasures —
    // 2 of 3,651 clients have INACTIVE_TS, 1 since reactivated (2026-10-12 backup).
    isActive: !(client.INACTIVE_TS && (!client.ACTIVE_TS || client.ACTIVE_TS <= client.INACTIVE_TS)),
    name,
    phone: lookups.phoneByClientId.get(client.CLIENT_ID)?.trim() || null,
    email: lookups.emailByClientId.get(client.CLIENT_ID)?.trim() || null,
    mailingAddress,
    paymentMethod,
    splitPercent,
    // Store accounts are never owed money (Teabox's isBalanceBearing rule), so their
    // Liberty ledger balances — some sizable, e.g. ~$24k on "2006 Inventory" — are
    // dropped rather than carried as a debt to the shop itself.
    currentBalance: client.CLIENT_TYPE_ID === 3 ? 0 : lookups.balanceByClientId.get(client.CLIENT_ID) ?? 0,
    // When the client was opened in Liberty, not when the migration ran. ~38% of
    // Hidden Treasures clients share CREATE_TS 2002-08-23 00:00 (the earliest value —
    // apparently when existing records were first loaded into Liberty); kept as-is,
    // since it's the best date Liberty has. The fallbacks only cover a NULL CREATE_TS
    // (1 row as of 2026-10-10: CLIENT_ID 3).
    createdAt: client.CREATE_TS ?? client.ACTIVE_TS ?? client.LAST_UPDATE_TS ?? null,
  };
}
