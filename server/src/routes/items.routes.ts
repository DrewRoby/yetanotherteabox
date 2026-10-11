import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { authenticate } from "../middleware/auth";
import { requireRole } from "../middleware/requireRole";
import { recordAudit } from "../lib/audit";
import { ITEM_STATUSES } from "../lib/enums";
import { IntakeAccountError, nextItemIdentity, resolveIntakeAccountId } from "../services/items.service";
import { itemListQuerySchema, listCategories, listItems } from "../services/itemList.service";
import { printTagBatch } from "../adapters/printer";
import { suggestMetadata } from "../adapters/cv";

export const itemsRouter = Router();
itemsRouter.use(authenticate);

// Inventory Browser — staff-wide view of the store's inventory.
itemsRouter.get("/", requireRole("SYSTEM_ADMIN", "OWNER", "MANAGER", "EMPLOYEE"), async (req, res) => {
  const { q, category, status, accountId } = req.query;
  const items = await prisma.item.findMany({
    where: {
      storeId: req.session!.storeId,
      ...(status ? { status: String(status) } : {}),
      ...(category ? { category: String(category) } : {}),
      ...(accountId ? { accountId: String(accountId) } : {}),
      ...(q
        ? {
            OR: [
              { description: { contains: String(q) } },
              { brand: { contains: String(q) } },
              { sku: { contains: String(q) } },
            ],
          }
        : {}),
    },
    include: { account: { select: { id: true, name: true, accountType: true } } },
    orderBy: { intakeDate: "desc" },
    take: 200,
  });
  res.json(items);
});

// Inventory page: the whole store's items, filtered/sorted/paged server-side — see
// services/itemList.service.ts. (GET / above stays as-is for the Booth Owner Pricing
// page, which wants a plain array for one account.) Registered before GET /:id so
// "browse"/"categories" aren't taken for item ids.
itemsRouter.get("/browse", requireRole("SYSTEM_ADMIN", "OWNER", "MANAGER", "EMPLOYEE"), async (req, res) => {
  const parsed = itemListQuerySchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { query, page, pageSize } = parsed.data;
  const result = await listItems({ storeId: req.session!.storeId }, query);
  res.json({ ...result, page, pageSize });
});

itemsRouter.get("/categories", requireRole("SYSTEM_ADMIN", "OWNER", "MANAGER", "EMPLOYEE"), async (req, res) => {
  res.json(await listCategories(req.session!.storeId));
});

itemsRouter.get("/:id", async (req, res) => {
  const item = await prisma.item.findFirst({
    where: { id: req.params.id, storeId: req.session!.storeId },
    include: {
      account: true,
      photos: true,
      history: { orderBy: { timestamp: "desc" } },
      // Lets the detail page show the sale and know up front what PATCH/DELETE
      // will refuse (sold items' price/status/account; any financial record).
      sales: { select: { id: true, saleDate: true, salePrice: true }, orderBy: { saleDate: "desc" } },
      _count: { select: { payoutLines: true } },
    },
  });
  if (!item) return res.status(404).json({ error: "Item not found" });

  const session = req.session!;
  const isStaff = ["SYSTEM_ADMIN", "OWNER", "MANAGER", "EMPLOYEE"].includes(session.activeRole);
  const ownsItem = session.accountId === item.accountId;
  if (!isStaff && !ownsItem) {
    return res.status(403).json({ error: "Not authorized to view this item" });
  }
  res.json(item);
});

const intakeSchema = z.object({
  description: z.string().min(1),
  category: z.string().min(1),
  subcategory: z.string().optional(),
  brand: z.string().optional(),
  style: z.string().optional(),
  pattern: z.string().optional(),
  size: z.string().optional(),
  serialNumber: z.string().optional(),
  condition: z.string().optional(),
  consignmentType: z.string().optional(),
  priceQuickSale: z.number().positive().optional(),
  price: z.number().positive(),
  pricePremium: z.number().positive().optional(),
  accountId: z.string().nullable().optional(),
  photoUrl: z.string().optional(),
});

// Item Intake. accountId resolution follows resolveIntakeAccountId's rules — see
// that function for the Consignor/Booth-Owner-vs-staff branch (tasks 825fcb1e,
// 1a912596, c3ec7969). Logs an INTAKE history entry. Tag printing is deferred to
// POST /print-batch below — IntakePage queues each saved item into a batch instead
// of printing one tag at a time, so a clerk entering several items walks to the
// printer once.
itemsRouter.post("/", async (req, res) => {
  const parsed = intakeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  let accountId: string;
  try {
    accountId = await resolveIntakeAccountId(req.session!, parsed.data.accountId);
  } catch (err) {
    if (err instanceof IntakeAccountError) return res.status(400).json({ error: err.message });
    throw err;
  }

  // itemNumber + sku are assigned inside the same transaction as the create so two
  // concurrent intakes for this store can't compute the same number (see
  // nextItemIdentity in items.service.ts).
  const storeId = req.session!.storeId;
  const item = await prisma.$transaction(async (tx) => {
    const { itemNumber, sku } = await nextItemIdentity(tx, storeId);
    return tx.item.create({
      data: {
        sku,
        itemNumber,
        description: parsed.data.description,
        category: parsed.data.category,
        subcategory: parsed.data.subcategory,
        brand: parsed.data.brand,
        style: parsed.data.style,
        pattern: parsed.data.pattern,
        size: parsed.data.size,
        serialNumber: parsed.data.serialNumber,
        condition: parsed.data.condition,
        consignmentType: parsed.data.consignmentType,
        priceQuickSale: parsed.data.priceQuickSale,
        price: parsed.data.price,
        pricePremium: parsed.data.pricePremium,
        status: "AVAILABLE",
        accountId,
        storeId,
        photos: parsed.data.photoUrl
          ? { create: [{ url: parsed.data.photoUrl, source: "MANUAL" }] }
          : undefined,
        history: {
          create: [
            {
              changeType: "INTAKE",
              newValue: `Intake at $${parsed.data.price.toFixed(2)}`,
              changedById: req.session!.sub,
              activeRole: req.session!.activeRole,
            },
          ],
        },
      },
    });
  });

  await recordAudit(req.session!, "Item", item.id, "INTAKE", { accountId, sku: item.sku });
  res.status(201).json({ item });
});

const printBatchSchema = z.object({ itemIds: z.array(z.string()).min(1) });

// Sends one print job per item to the label printer, called once from IntakePage's
// "Print Batch" action after a clerk has queued up several intake tickets. Re-reads
// each item from the DB rather than trusting client-supplied ticket text, so a
// tampered price/description can't reach the printer — same isAccountScoped-or-staff
// check as GET /:id, since a Consignor/Booth Owner may only reprint their own items.
itemsRouter.post("/print-batch", async (req, res) => {
  const parsed = printBatchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const session = req.session!;
  const items = await prisma.item.findMany({
    where: { id: { in: parsed.data.itemIds }, storeId: session.storeId },
  });
  const isStaff = ["SYSTEM_ADMIN", "OWNER", "MANAGER", "EMPLOYEE"].includes(session.activeRole);
  const authorized = items.filter((item) => isStaff || session.accountId === item.accountId);
  if (authorized.length !== parsed.data.itemIds.length) {
    return res.status(403).json({ error: "Not authorized to print tags for one or more of these items" });
  }

  const results = await printTagBatch(
    authorized.map((item) => ({
      sku: item.sku,
      description: item.description,
      price: item.price,
      category: item.category,
      size: item.size ?? undefined,
    }))
  );
  for (const item of authorized) {
    await recordAudit(session, "Item", item.id, "PRINT_TAG", { sku: item.sku });
  }
  res.json({ printed: results });
});

// Computer-vision metadata suggestion stub, called after a photo is captured on the
// Intake screen (tech_stack_document.md's cloud CV step).
itemsRouter.post("/suggest-metadata", async (req, res) => {
  const photoUrl = typeof req.body?.photoUrl === "string" ? req.body.photoUrl : "";
  const suggestion = await suggestMetadata(photoUrl);
  res.json(suggestion);
});

const priceUpdateSchema = z.object({ price: z.number().positive() });

// Used by both staff price overrides and the Booth Owner Pricing screen's inline
// edits / bulk adjustment — a Booth Owner may only touch items on their own account.
itemsRouter.put("/:id/price", async (req, res) => {
  const parsed = priceUpdateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const item = await prisma.item.findFirst({ where: { id: req.params.id, storeId: req.session!.storeId } });
  if (!item) return res.status(404).json({ error: "Item not found" });

  const session = req.session!;
  const isStaff = ["SYSTEM_ADMIN", "OWNER", "MANAGER"].includes(session.activeRole);
  const isOwnBoothItem = session.activeRole === "BOOTH_OWNER" && session.accountId === item.accountId;
  if (!isStaff && !isOwnBoothItem) {
    return res.status(403).json({ error: "Not authorized to reprice this item" });
  }

  const oldPrice = item.price;
  const updated = await prisma.item.update({
    where: { id: item.id },
    data: {
      price: parsed.data.price,
      history: {
        create: [
          {
            changeType: "PRICE_CHANGE",
            oldValue: `$${oldPrice.toFixed(2)}`,
            newValue: `$${parsed.data.price.toFixed(2)}`,
            changedById: session.sub,
            activeRole: session.activeRole,
          },
        ],
      },
    },
  });
  await recordAudit(session, "Item", item.id, "PRICE_CHANGE", { oldPrice, newPrice: parsed.data.price });
  res.json(updated);
});

const statusUpdateSchema = z.object({ status: z.enum(ITEM_STATUSES) });

itemsRouter.put(
  "/:id/status",
  requireRole("SYSTEM_ADMIN", "OWNER", "MANAGER", "EMPLOYEE"),
  async (req, res) => {
    const parsed = statusUpdateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const item = await prisma.item.findFirst({ where: { id: req.params.id, storeId: req.session!.storeId } });
    if (!item) return res.status(404).json({ error: "Item not found" });
    const updated = await prisma.item.update({
      where: { id: item.id },
      data: {
        status: parsed.data.status,
        history: {
          create: [
            {
              changeType: "STATUS_CHANGE",
              oldValue: item.status,
              newValue: parsed.data.status,
              changedById: req.session!.sub,
              activeRole: req.session!.activeRole,
            },
          ],
        },
      },
    });
    await recordAudit(req.session!, "Item", item.id, "STATUS_CHANGE", { from: item.status, to: parsed.data.status });
    res.json(updated);
  }
);

// ---- Item detail page: edit / delete ----

const STAFF_ROLES = ["SYSTEM_ADMIN", "OWNER", "MANAGER", "EMPLOYEE"] as const;
// Same split as PUT /:id/price: Employees may fix an item's description and status,
// but repricing it or moving it to another account (whose split it's credited at)
// takes a Manager or above.
const PRICE_AND_ACCOUNT_ROLES = ["SYSTEM_ADMIN", "OWNER", "MANAGER"] as const;
// SOLD is only ever set by POS checkout (which records the Sale and credits the
// account) — never by hand.
const EDITABLE_STATUSES = ITEM_STATUSES.filter((s) => s !== "SOLD") as [string, ...string[]];

const optionalText = z.string().trim().max(500).nullable().optional(); // null/"" clears the field
const itemEditSchema = z
  .object({
    description: z.string().trim().min(1).max(500).optional(),
    category: z.string().trim().min(1).max(100).optional(),
    subcategory: optionalText,
    brand: optionalText,
    style: optionalText,
    pattern: optionalText,
    size: optionalText,
    serialNumber: optionalText,
    condition: optionalText,
    price: z.number().positive().optional(),
    priceQuickSale: z.number().positive().nullable().optional(),
    pricePremium: z.number().positive().nullable().optional(),
    status: z.enum(EDITABLE_STATUSES).optional(),
    accountId: z.string().min(1).optional(),
  })
  .strict();

const TEXT_FIELDS = ["description", "category", "subcategory", "brand", "style", "pattern", "size", "serialNumber", "condition"] as const;
const money = (n: number | null | undefined) => (n == null ? "—" : `$${n.toFixed(2)}`);

// Edits whatever subset of fields is sent. Each kind of change lands in the item's
// history the way the dedicated routes already record it (PRICE_CHANGE /
// STATUS_CHANGE) plus one EDIT entry listing any other changed fields, and one audit
// entry with the full before/after. A SOLD item's price, status and account are
// frozen — its Sale and the account's credit were recorded against them.
itemsRouter.patch("/:id", requireRole(...STAFF_ROLES), async (req, res) => {
  const parsed = itemEditSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const session = req.session!;
  const item = await prisma.item.findFirst({ where: { id: req.params.id, storeId: session.storeId } });
  if (!item) return res.status(404).json({ error: "Item not found" });
  const input = parsed.data;

  const priceFields = (["price", "priceQuickSale", "pricePremium"] as const).filter(
    (f) => input[f] !== undefined && input[f] !== item[f]
  );
  const accountChanged = input.accountId !== undefined && input.accountId !== item.accountId;
  const statusChanged = input.status !== undefined && input.status !== item.status;

  if ((priceFields.length || accountChanged) && !(PRICE_AND_ACCOUNT_ROLES as readonly string[]).includes(session.activeRole)) {
    return res.status(403).json({ error: "Only a Manager, Owner or Admin can change an item's price or account" });
  }
  if (item.status === "SOLD" && (priceFields.length || accountChanged || statusChanged)) {
    return res.status(409).json({
      error: "This item has been sold — its price, status and account are fixed by the sale. Only its description details can be edited.",
    });
  }
  let accountNote = "";
  if (accountChanged) {
    const target = await prisma.account.findFirst({ where: { id: input.accountId, storeId: session.storeId } });
    if (!target) return res.status(400).json({ error: "That account doesn't belong to this store" });
    const current = await prisma.account.findUniqueOrThrow({ where: { id: item.accountId }, select: { name: true } });
    accountNote = `account: ${current.name} → ${target.name}`;
  }

  const data: Record<string, unknown> = {};
  const before: Record<string, unknown> = {};
  const editNotes: string[] = [];
  for (const f of TEXT_FIELDS) {
    if (input[f] === undefined) continue;
    const next = input[f] === "" ? null : input[f];
    if (next === item[f]) continue;
    data[f] = next;
    before[f] = item[f];
    editNotes.push(`${f}: ${item[f] ?? "—"} → ${next ?? "—"}`);
  }
  for (const f of priceFields) {
    data[f] = input[f];
    before[f] = item[f];
    if (f !== "price") editNotes.push(`${f}: ${money(item[f])} → ${money(input[f])}`);
  }
  if (statusChanged) {
    data.status = input.status;
    before.status = item.status;
  }
  if (accountChanged) {
    data.accountId = input.accountId;
    before.accountId = item.accountId;
    editNotes.push(accountNote);
  }
  if (Object.keys(data).length === 0) return res.json(item);

  const history = [
    ...(priceFields.includes("price")
      ? [{ changeType: "PRICE_CHANGE", oldValue: money(item.price), newValue: money(input.price) }]
      : []),
    ...(statusChanged ? [{ changeType: "STATUS_CHANGE", oldValue: item.status, newValue: input.status! }] : []),
    ...(editNotes.length ? [{ changeType: "EDIT", oldValue: null, newValue: editNotes.join("; ") }] : []),
  ].map((h) => ({ ...h, changedById: session.sub, activeRole: session.activeRole }));

  const updated = await prisma.item.update({
    where: { id: item.id },
    data: { ...data, history: { create: history } },
  });
  await recordAudit(session, "Item", item.id, "EDIT", { before, after: data });
  res.json(updated);
});

// Hard delete, for mistakes (a duplicate or test intake). Refused once the item has
// any financial record — a Sale or a PayoutLine — since removing it would leave a
// sale or a payout pointing at nothing; mark such an item DISPOSED instead. The audit
// entry keeps a snapshot of what was deleted.
itemsRouter.delete("/:id", requireRole(...PRICE_AND_ACCOUNT_ROLES), async (req, res) => {
  const session = req.session!;
  const item = await prisma.item.findFirst({
    where: { id: req.params.id, storeId: session.storeId },
    include: { _count: { select: { sales: true, payoutLines: true } } },
  });
  if (!item) return res.status(404).json({ error: "Item not found" });
  if (item._count.sales || item._count.payoutLines) {
    return res.status(409).json({
      error: "This item has sale or payout records, so it can't be deleted. Set its status to Disposed instead.",
    });
  }
  const { _count, ...snapshot } = item;
  await prisma.$transaction([
    prisma.itemHistory.deleteMany({ where: { itemId: item.id } }),
    prisma.photo.deleteMany({ where: { itemId: item.id } }),
    prisma.item.delete({ where: { id: item.id } }),
  ]);
  await recordAudit(session, "Item", item.id, "DELETE", { snapshot });
  res.status(204).end();
});
