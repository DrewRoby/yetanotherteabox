import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { authenticate } from "../middleware/auth";
import { requireRole } from "../middleware/requireRole";
import { recordAudit } from "../lib/audit";
import { ITEM_STATUSES } from "../lib/enums";
import { generateSku, IntakeAccountError, resolveIntakeAccountId } from "../services/items.service";
import { printTag } from "../adapters/printer";
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

itemsRouter.get("/:id", async (req, res) => {
  const item = await prisma.item.findFirst({
    where: { id: req.params.id, storeId: req.session!.storeId },
    include: {
      account: true,
      photos: true,
      history: { orderBy: { timestamp: "desc" } },
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
// 1a912596, c3ec7969). Always prints a tag and logs an INTAKE history entry.
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

  const sku = await generateSku(parsed.data.category);
  const item = await prisma.item.create({
    data: {
      sku,
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
      storeId: req.session!.storeId,
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

  const printResult = await printTag({ sku: item.sku, description: item.description, price: item.price });
  await recordAudit(req.session!, "Item", item.id, "INTAKE", { accountId, sku: item.sku });
  res.status(201).json({ item, print: printResult });
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
