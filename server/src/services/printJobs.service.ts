import type { Item } from "@prisma/client";
import { printTagBatch } from "../adapters/printer";
import { recordAuditMany } from "../lib/audit";
import type { SessionClaims } from "../lib/jwt";
import { prisma } from "../lib/prisma";

export const PRINT_JOB_SOURCES = ["INTAKE", "ITEM", "REPRINT"] as const;
export type PrintJobSource = (typeof PRINT_JOB_SOURCES)[number];

// Every tag print goes through here: sends the batch to the printer and records it as
// one PrintJob (Reports > Print Queues) with a snapshot of what each tag said, plus the
// per-item PRINT_TAG audit entries. `items` must already be authorized and come from
// the DB (never client-supplied ticket text); they print in the order given.
export async function printItemsAsJob(
  session: SessionClaims,
  items: Item[],
  source: PrintJobSource,
  reprintOfId?: string
) {
  const tickets = items.map((item) => ({
    sku: item.sku,
    description: item.description,
    price: item.price,
    category: item.category,
    size: item.size ?? undefined,
  }));
  const results = await printTagBatch(tickets);
  const printedAt = new Date();
  await prisma.item.updateMany({ where: { id: { in: items.map((i) => i.id) } }, data: { tagPrintedAt: printedAt } });
  const job = await prisma.printJob.create({
    data: {
      storeId: session.storeId,
      createdAt: printedAt,
      createdById: session.sub,
      activeRole: session.activeRole,
      source,
      reprintOfId,
      itemCount: items.length,
      items: {
        create: items.map((item, position) => ({
          position,
          itemId: item.id,
          sku: item.sku,
          description: item.description,
          price: item.price,
          category: item.category,
          size: item.size,
        })),
      },
    },
  });
  await recordAuditMany(
    session,
    "Item",
    items.map((item) => ({ entityId: item.id, action: "PRINT_TAG", details: { sku: item.sku, printJobId: job.id } }))
  );
  return { job, results };
}

// Loads items by id for printing, in the requested order, applying the staff-or-own-
// account rule (a Consignor/Booth Owner may only print their own items). Returns null
// if any id is missing from the store or not authorized.
export async function loadPrintableItems(session: SessionClaims, itemIds: string[]): Promise<Item[] | null> {
  const items = await prisma.item.findMany({ where: { id: { in: itemIds }, storeId: session.storeId } });
  const isStaff = ["SYSTEM_ADMIN", "OWNER", "MANAGER", "EMPLOYEE"].includes(session.activeRole);
  const byId = new Map(items.filter((item) => isStaff || session.accountId === item.accountId).map((i) => [i.id, i]));
  const ordered = itemIds.map((id) => byId.get(id));
  return ordered.every((i): i is Item => i != null) ? ordered : null;
}
