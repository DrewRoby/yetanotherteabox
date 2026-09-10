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
  name: string;
  phone: string | null;
  email: string | null;
  mailingAddress: string | null;
  paymentMethod: string | null;
  splitPercent: number | null;
  currentBalance: number;
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
    name,
    phone: lookups.phoneByClientId.get(client.CLIENT_ID)?.trim() || null,
    email: lookups.emailByClientId.get(client.CLIENT_ID)?.trim() || null,
    mailingAddress,
    paymentMethod,
    splitPercent,
    currentBalance: lookups.balanceByClientId.get(client.CLIENT_ID) ?? 0,
  };
}
