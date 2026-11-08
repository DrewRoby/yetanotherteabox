import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { parseTagNumber } from "../lib/barcode";
import type { SessionClaims } from "../lib/jwt";
import { recordAuditMany } from "../lib/audit";
import { consignorShareOf, isBalanceBearing } from "./accounts.service";

// HOLDING accounts — Lost & Found (Hidden Treasures: Liberty client 101550, account
// 2834). Someone with an account drops off goods without marking them as theirs; the
// goods are entered under the holding account and sell normally, and once staff know
// whose they were, the item is *claimed* for that person's account and they are
// credited then. The holding account itself is never owed anything and never paid out
// (not balance-bearing, see lib/enums.ts), so "what's waiting to be claimed" is derived
// from its items rather than kept as a balance:
//
//   unclaimed = still on the floor (AVAILABLE/PENDING)
//             or SOLD with a sale > $0 that no payout covers.
//
// A sale with a PayoutLine was settled before Teabox (Liberty swept some Lost & Found
// credits into payouts), and a $0 "sale" is how Liberty closed out donated items —
// neither is anyone's money to claim.
//
// Both reads below are raw SQL on purpose: Prisma renders `payoutLines: { none: {} }`
// as `NOT IN (SELECT saleId FROM PayoutLine)`, which scans every PayoutLine in the
// store (~5s on the migrated data). NOT EXISTS rides PayoutLine's saleId index, and
// the account's items are found first (Item.accountId index). A holding account holds
// a few thousand items at most, so filtering/paging the result in memory is cheap.

export const ON_FLOOR = ["AVAILABLE", "PENDING"];

interface HeldItem {
  id: string;
  sku: string;
  tagAccountNumber: number | null;
  accountItemNumber: number | null;
  description: string;
  category: string;
  status: string;
  price: number;
  intakeDate: Date;
  soldAt: Date | null;
  consignorPercent: number | null;
  sales: { salePrice: number; saleDate: Date }[]; // only the claimable ones
}

const num = (v: unknown) => (v == null ? null : Number(v));
const date = (v: unknown) => (v == null ? null : new Date(Number(v)));

// Every unclaimed item on the account, with its claimable sales. `only` narrows to
// specific item ids (a claim) — still checked against the same rule.
async function heldItems(db: Prisma.TransactionClient, accountId: string, only?: string[]): Promise<HeldItem[]> {
  const items = await db.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT i."id", i."sku", i."tagAccountNumber", i."accountItemNumber", i."description", i."category", i."status",
            i."price", i."intakeDate", i."soldAt", i."consignorPercent"
     FROM "Item" i
     WHERE i."accountId" = ?1 AND i."status" IN ('AVAILABLE','PENDING','SOLD')`,
    accountId
  );
  const sales = await db.$queryRawUnsafe<{ itemId: string; salePrice: unknown; saleDate: unknown }[]>(
    `SELECT s."itemId", s."salePrice", s."saleDate"
     FROM "Item" i JOIN "Sale" s ON s."itemId" = i."id"
     WHERE i."accountId" = ?1 AND i."status" = 'SOLD' AND s."salePrice" > 0
       AND NOT EXISTS (SELECT 1 FROM "PayoutLine" pl WHERE pl."saleId" = s."id")`,
    accountId
  );
  const salesByItem = new Map<string, HeldItem["sales"]>();
  for (const s of sales) {
    const list = salesByItem.get(s.itemId) ?? [];
    list.push({ salePrice: Number(s.salePrice), saleDate: date(s.saleDate)! });
    salesByItem.set(s.itemId, list);
  }
  const wanted = only ? new Set(only) : null;
  return items
    .map((r) => ({
      id: String(r.id),
      sku: String(r.sku),
      tagAccountNumber: num(r.tagAccountNumber),
      accountItemNumber: num(r.accountItemNumber),
      description: String(r.description),
      category: String(r.category),
      status: String(r.status),
      price: Number(r.price),
      intakeDate: date(r.intakeDate)!,
      soldAt: date(r.soldAt),
      consignorPercent: num(r.consignorPercent),
      sales: salesByItem.get(String(r.id)) ?? [],
    }))
    .filter((i) => (ON_FLOOR.includes(i.status) || i.sales.length > 0) && (!wanted || wanted.has(i.id)));
}

export interface UnclaimedQuery {
  q?: string;
  show: "all" | "sold" | "floor";
  soldBefore?: Date;
  page: number;
  pageSize: number;
}

function matches(i: HeldItem, query: Pick<UnclaimedQuery, "q" | "show" | "soldBefore">): boolean {
  if (query.show === "sold" && i.status !== "SOLD") return false;
  if (query.show === "floor" && i.status === "SOLD") return false;
  if (query.soldBefore && !(i.status === "SOLD" && i.soldAt && i.soldAt < query.soldBefore)) return false;
  if (query.q) {
    const tag = parseTagNumber(query.q);
    if (tag) return i.tagAccountNumber === tag.tagAccountNumber && i.accountItemNumber === tag.accountItemNumber;
    const q = query.q.toLowerCase();
    return i.description.toLowerCase().includes(q) || i.sku.toLowerCase().includes(q);
  }
  return true;
}

// The holding account page's "Waiting to be claimed" list, newest sale first (unsold
// items after, newest intake first). estShare uses the item's own split, else the
// holding account's — the final credit uses the claimant's split for items without one.
export async function listUnclaimed(account: { id: string; splitPercent: number | null }, query: UnclaimedQuery) {
  const all = await heldItems(prisma, account.id);
  const share = (i: HeldItem) =>
    roundCents(i.sales.reduce((t, s) => t + consignorShareOf(s.salePrice, i.consignorPercent ?? account.splitPercent), 0));
  const gross = (i: HeldItem) => roundCents(i.sales.reduce((t, s) => t + s.salePrice, 0));

  const totals = { soldCount: 0, soldGross: 0, soldEstShare: 0, floorCount: 0, floorRetail: 0 };
  for (const i of all) {
    if (i.status === "SOLD") {
      totals.soldCount++;
      totals.soldGross += gross(i);
      totals.soldEstShare += share(i);
    } else {
      totals.floorCount++;
      totals.floorRetail += i.price;
    }
  }

  const filtered = all
    .filter((i) => matches(i, query))
    .sort(
      (a, b) =>
        (b.soldAt?.getTime() ?? -1) - (a.soldAt?.getTime() ?? -1) || b.intakeDate.getTime() - a.intakeDate.getTime()
    );
  const page = filtered.slice((query.page - 1) * query.pageSize, query.page * query.pageSize);
  return {
    total: filtered.length,
    totals: {
      ...totals,
      soldGross: roundCents(totals.soldGross),
      soldEstShare: roundCents(totals.soldEstShare),
      floorRetail: roundCents(totals.floorRetail),
    },
    items: page.map(({ sales, consignorPercent, ...i }) => ({
      ...i,
      salePrice: sales.length ? gross({ sales } as HeldItem) : null,
      estShare: sales.length ? share({ sales, consignorPercent } as HeldItem) : null,
    })),
  };
}

export class ClaimError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

// Claims items off a HOLDING account for `targetAccountId`: moves each item there
// (its tag number stays — it's what's printed), stamps Item.claimedAt, and credits the
// target with every claimable sale's consignor share — item split, else the target's
// split, the checkout rule — when the target is balance-bearing. Claiming for the
// store (built-in STORE account or a store account) is how an unclaimed sale is
// released: the item moves and nobody is credited. Either an explicit list of items
// (each must still be unclaimed) or every unclaimed sale sold before a date.
export async function claimHeldItems(
  session: SessionClaims,
  holdingAccountId: string,
  targetAccountId: string,
  selection: { itemIds: string[] } | { soldBefore: Date }
) {
  const now = new Date();
  const result = await prisma.$transaction(
    async (tx) => {
      const holding = await tx.account.findFirst({ where: { id: holdingAccountId, storeId: session.storeId } });
      if (!holding) throw new ClaimError(404, "Account not found");
      if (holding.accountType !== "HOLDING") throw new ClaimError(400, "Only Lost & Found (holding) accounts have items to claim");
      const target = await tx.account.findFirst({ where: { id: targetAccountId, storeId: session.storeId } });
      if (!target) throw new ClaimError(400, "That account doesn't belong to this store");
      if (target.accountType === "HOLDING") throw new ClaimError(400, "Pick the person's own account, not another holding account");
      if (!target.isActive) throw new ClaimError(400, `${target.name} is inactive — reactivate it before claiming items for it`);

      let items: HeldItem[];
      if ("itemIds" in selection) {
        const ids = [...new Set(selection.itemIds)];
        items = await heldItems(tx, holding.id, ids);
        if (items.length !== ids.length) {
          throw new ClaimError(
            409,
            `${ids.length - items.length} of the selected items are no longer waiting to be claimed — reload and try again`
          );
        }
      } else {
        items = (await heldItems(tx, holding.id)).filter((i) => matches(i, { show: "sold", soldBefore: selection.soldBefore }));
      }
      if (items.length === 0) throw new ClaimError(400, "No items to claim");

      const bearing = isBalanceBearing(target);
      const perItem = items.map((i) => ({
        id: i.id,
        sold: i.status === "SOLD",
        credit: bearing
          ? roundCents(i.sales.reduce((t, s) => t + consignorShareOf(s.salePrice, i.consignorPercent ?? target.splitPercent), 0))
          : 0,
      }));
      const credited = roundCents(perItem.reduce((t, p) => t + p.credit, 0));
      const ids = perItem.map((p) => p.id);

      for (let k = 0; k < ids.length; k += 500) {
        await tx.item.updateMany({ where: { id: { in: ids.slice(k, k + 500) } }, data: { accountId: target.id, claimedAt: now } });
      }
      await tx.itemHistory.createMany({
        data: perItem.map((p) => ({
          itemId: p.id,
          changeType: "EDIT",
          oldValue: null,
          newValue:
            `claimed: ${holding.name} → ${target.name}` +
            (p.sold ? (bearing ? `; credited $${p.credit.toFixed(2)}` : "; sale kept by the store") : ""),
          changedById: session.sub,
          activeRole: session.activeRole,
          timestamp: now,
        })),
      });
      const latestMs = Math.max(0, ...items.flatMap((i) => i.sales.map((s) => s.saleDate.getTime())));
      const lastSaleAt =
        latestMs > 0 && (!target.lastSaleAt || latestMs > target.lastSaleAt.getTime()) ? new Date(latestMs) : null;
      if (credited !== 0 || lastSaleAt) {
        await tx.account.update({
          where: { id: target.id },
          data: {
            ...(credited !== 0 ? { currentBalance: { increment: credited } } : {}),
            ...(lastSaleAt ? { lastSaleAt } : {}),
          },
        });
      }
      return { holding, target, perItem, credited };
    },
    { timeout: 60_000 }
  );

  await recordAuditMany(
    session,
    "Item",
    result.perItem.map((p) => ({
      entityId: p.id,
      action: "CLAIM_HELD_ITEM",
      details: { fromAccountId: result.holding.id, toAccountId: result.target.id, credit: p.credit },
    }))
  );
  return {
    claimed: result.perItem.length,
    sold: result.perItem.filter((p) => p.sold).length,
    credited: result.credited,
    target: { id: result.target.id, name: result.target.name, accountNumber: result.target.accountNumber },
  };
}

function roundCents(n: number): number {
  return Math.round(n * 100) / 100;
}
