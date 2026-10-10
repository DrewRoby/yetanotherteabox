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
  lastSaleAt: Date | null;
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
    lastSaleAt: account.lastSaleAt,
    ...(showsBalance ? { currentBalance: account.currentBalance } : {}),
  };
}

// What a sale credits the owning account — the single formula shared by POS checkout
// (which adds it to currentBalance) and payout itemization (which reports it per line).
export function consignorShareOf(salePrice: number, splitPercent: number | null): number {
  return (salePrice * (splitPercent ?? 100)) / 100;
}

// Pays out an account's full current balance as one PAID Payout, itemized with a SALE
// line per sale not yet covered by any earlier payout. Unpaid = no PayoutLine *and*
// sold after the account's latest PAID payout: the date floor keeps historical sales
// that a migrated system never itemized (Liberty left ~3% of its sale credits
// unlinked) from being swept into today's check. Whatever the itemized lines don't
// account for (e.g. a balance carried over from migration) becomes one explicit
// ADJUSTMENT line, so lines always sum to the amount actually paid.
export async function generatePaidPayout(account: {
  id: string;
  currentBalance: number;
  splitPercent: number | null;
}) {
  const amount = account.currentBalance;
  const lastPaid = await prisma.payout.findFirst({
    where: { accountId: account.id, status: "PAID" },
    orderBy: { createdAt: "desc" },
  });
  const unpaidSales = await prisma.sale.findMany({
    where: {
      item: { accountId: account.id },
      payoutLines: { none: {} },
      ...(lastPaid ? { saleDate: { gt: lastPaid.paidAt ?? lastPaid.createdAt } } : {}),
    },
    include: { item: { select: { id: true, description: true } } },
    orderBy: { saleDate: "asc" },
  });

  const lines: { lineType: string; itemId?: string; saleId?: string; description: string | null; amount: number }[] =
    unpaidSales.map((s) => ({
      lineType: "SALE",
      itemId: s.item.id,
      saleId: s.id,
      description: s.item.description,
      amount: roundCents(consignorShareOf(s.salePrice, account.splitPercent)),
    }));
  const remainder = roundCents(amount - lines.reduce((sum, l) => sum + l.amount, 0));
  if (remainder !== 0) {
    lines.push({ lineType: "ADJUSTMENT", description: "Balance not attributable to itemized sales", amount: remainder });
  }

  const [payout] = await prisma.$transaction([
    prisma.payout.create({
      data: { accountId: account.id, amount, status: "PAID", paidAt: new Date(), lines: { create: lines } },
    }),
    prisma.account.update({ where: { id: account.id }, data: { currentBalance: 0 } }),
  ]);
  return payout;
}

function roundCents(n: number): number {
  return Math.round(n * 100) / 100;
}

export async function getOrCreateStoreAccount(storeId: string) {
  const existing = await prisma.account.findFirst({ where: { storeId, accountType: "STORE" } });
  if (existing) return existing;
  return prisma.account.create({
    data: { storeId, accountType: "STORE", name: "Store-Owned Inventory" },
  });
}
