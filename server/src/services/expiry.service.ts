import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import type { SessionClaims } from "../lib/jwt";
import { recordAudit } from "../lib/audit";
import { CONSIGNMENT_DAYS } from "../lib/enums";

// Consignment expiry (Hidden Treasures' policy, confirmed by the owner 2026-11-08):
// almost nobody collects unsold items after the consignment period, so an expired
// consignment is DONATED — and with Store.autoDonate on, Teabox marks it so itself
// instead of leaving it "Available" forever. Occasionally a nice overlooked item is
// kept and becomes store inventory instead: flipToStore() below, reachable from the
// item page and from the register when a donated item is scanned (it was still on
// the floor). Both apply regardless of the consignor's old "donate if unsold" flag —
// the store's policy overrides it.

const DAY_MS = 24 * 60 * 60 * 1000;
export const SYSTEM_ROLE = "SYSTEM"; // ItemHistory.activeRole / AuditLog.activeRole for automatic changes

// An expired consignment: still on the floor, on an ordinary consignor's account, in
// past the consignment period, and actually consigned — an item whose split pays the
// consignor nothing ("100% to store") is effectively the store's already. Booth
// owners' and vendors' items, Lost & Found (HOLDING) and store-owned stock never expire.
export function expiredConsignmentWhere(storeId: string, now: Date): Prisma.ItemWhereInput {
  return {
    storeId,
    status: { in: ["AVAILABLE", "PENDING"] },
    intakeDate: { lt: new Date(now.getTime() - CONSIGNMENT_DAYS * DAY_MS) },
    account: { accountType: "CONSIGNOR", isStoreAccount: false },
    OR: [
      { consignorPercent: { gt: 0 } },
      { consignorPercent: null, account: { OR: [{ splitPercent: null }, { splitPercent: { gt: 0 } }] } },
    ],
  };
}

// Marks every expired consignment DONATED, for each store with autoDonate on (or just
// `storeId`). Idempotent; safe to run as often as you like. Returns how many changed.
export async function runAutoDonate(storeId?: string): Promise<number> {
  const stores = await prisma.store.findMany({ where: { autoDonate: true, ...(storeId ? { id: storeId } : {}) }, select: { id: true } });
  let total = 0;
  for (const store of stores) {
    const now = new Date();
    const items = await prisma.item.findMany({
      where: expiredConsignmentWhere(store.id, now),
      select: { id: true, status: true },
    });
    for (let k = 0; k < items.length; k += 500) {
      const batch = items.slice(k, k + 500);
      await prisma.$transaction([
        prisma.item.updateMany({
          where: { id: { in: batch.map((b) => b.id) }, status: { in: ["AVAILABLE", "PENDING"] } },
          data: { status: "DONATED", donatedAt: now },
        }),
        prisma.itemHistory.createMany({
          data: batch.map((b) => ({
            itemId: b.id,
            changeType: "STATUS_CHANGE",
            oldValue: b.status,
            newValue: `DONATED (consignment expired after ${CONSIGNMENT_DAYS} days — automatic)`,
            changedById: null,
            activeRole: SYSTEM_ROLE,
            timestamp: now,
          })),
        }),
      ]);
    }
    if (items.length) {
      await prisma.auditLog.create({
        data: {
          entity: "Store",
          entityId: store.id,
          action: "AUTO_DONATE",
          activeRole: SYSTEM_ROLE,
          details: JSON.stringify({ items: items.length, consignmentDays: CONSIGNMENT_DAYS }),
        },
      });
    }
    total += items.length;
  }
  return total;
}

// Runs the job now and then hourly while the server is up — a shop's install isn't
// always running, so "daily at midnight" could be missed; hourly catches up on start.
export function startAutoDonateTimer() {
  const run = () =>
    runAutoDonate()
      .then((n) => n && console.log(`Auto-donate: ${n.toLocaleString()} expired consignment(s) marked DONATED`))
      .catch((err) => console.error("Auto-donate failed", err));
  setTimeout(run, 5_000).unref();
  setInterval(run, 60 * 60 * 1000).unref();
}

type FlipItem = {
  status: string;
  intakeDate: Date;
  consignorPercent: number | null;
  account: { accountType: string; isStoreAccount: boolean; splitPercent: number | null };
};

// Can this item be flipped to store inventory? A DONATED item (it turned out to still
// be here — whoever owned it), or an expired consignment still on the floor.
export function flipReason(item: FlipItem, now = new Date()): "donated" | "expired" | null {
  if (item.status === "DONATED") return "donated";
  if (item.status !== "AVAILABLE" && item.status !== "PENDING") return null;
  const a = item.account;
  if (a.accountType !== "CONSIGNOR" || a.isStoreAccount) return null;
  if ((item.consignorPercent ?? a.splitPercent ?? 100) <= 0) return null;
  return item.intakeDate.getTime() < now.getTime() - CONSIGNMENT_DAYS * DAY_MS ? "expired" : null;
}

export class FlipError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

// Flip to store inventory: the item goes back on the floor (AVAILABLE) as the store's —
// moved to the built-in STORE account (a later sale credits nobody), consignmentType
// "Expired Consignment", flippedAt = now (the store's acquisition date, for the
// year-end inventory count). A donated item already on a store account just comes back
// AVAILABLE. Its tag number stays — it's what's printed on the tag.
export async function flipToStore(session: SessionClaims, itemId: string) {
  const now = new Date();
  const item = await prisma.item.findFirst({
    where: { id: itemId, storeId: session.storeId },
    include: { account: true },
  });
  if (!item) throw new FlipError(404, "Item not found");
  const reason = flipReason(item, now);
  if (!reason) {
    throw new FlipError(409, "Only a donated item, or a consignment past its consignment period, can be flipped to store inventory");
  }
  const storeOwned = item.account.accountType === "STORE" || item.account.isStoreAccount;
  const storeAccount = storeOwned
    ? item.account
    : await prisma.account.findFirstOrThrow({ where: { storeId: session.storeId, accountType: "STORE" } });
  const fromConsignment = !storeOwned && item.account.accountType !== "HOLDING";

  const history: Prisma.ItemHistoryCreateWithoutItemInput[] = [];
  if (item.status !== "AVAILABLE") {
    history.push({ changeType: "STATUS_CHANGE", oldValue: item.status, newValue: "AVAILABLE (flipped to store inventory)" });
  }
  if (!storeOwned) {
    history.push({
      changeType: "EDIT",
      oldValue: null,
      newValue: `flipped to store inventory: account ${item.account.name} → ${storeAccount.name}`,
    });
  }
  const updated = await prisma.item.update({
    where: { id: item.id },
    data: {
      status: "AVAILABLE",
      donatedAt: null,
      ...(storeOwned ? {} : { accountId: storeAccount.id }),
      ...(fromConsignment ? { consignmentType: "Expired Consignment", flippedAt: now } : {}),
      history: {
        create: history.map((h) => ({ ...h, timestamp: now, changedBy: { connect: { id: session.sub } }, activeRole: session.activeRole })),
      },
    },
    include: { account: { select: { name: true } } },
  });
  await recordAudit(session, "Item", item.id, "FLIP_TO_STORE", {
    reason,
    fromStatus: item.status,
    fromAccountId: item.accountId,
    toAccountId: storeAccount.id,
  });
  return updated;
}
