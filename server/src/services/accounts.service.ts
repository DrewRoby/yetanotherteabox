import { prisma } from "../lib/prisma";
import { BALANCE_BEARING_ACCOUNT_TYPES, type AccountType } from "../lib/enums";

// Donor accounts are never owed money. This trims financial fields out of the API
// response entirely (rather than just hiding them in the UI) so a Donor profile
// cannot leak a balance to any client, per app_flow_document.md's account-type rules.
export function serializeAccount(account: {
  id: string;
  accountType: string;
  name: string;
  email: string | null;
  phone: string | null;
  splitPercent: number | null;
  currentBalance: number;
  createdAt: Date;
}) {
  const showsBalance = BALANCE_BEARING_ACCOUNT_TYPES.includes(account.accountType as AccountType);
  return {
    id: account.id,
    accountType: account.accountType,
    name: account.name,
    email: account.email,
    phone: account.phone,
    splitPercent: account.splitPercent,
    createdAt: account.createdAt,
    ...(showsBalance ? { currentBalance: account.currentBalance } : {}),
  };
}

export async function getOrCreateStoreAccount(storeId: string) {
  const existing = await prisma.account.findFirst({ where: { storeId, accountType: "STORE" } });
  if (existing) return existing;
  return prisma.account.create({
    data: { storeId, accountType: "STORE", name: "Store-Owned Inventory" },
  });
}
