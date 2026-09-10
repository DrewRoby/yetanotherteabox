import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { authenticate } from "../middleware/auth";
import { requireRole } from "../middleware/requireRole";
import { recordAudit } from "../lib/audit";
import { BALANCE_BEARING_ACCOUNT_TYPES, type AccountType } from "../lib/enums";

export const posRouter = Router();
posRouter.use(authenticate, requireRole("SYSTEM_ADMIN", "OWNER", "MANAGER", "EMPLOYEE", "REGISTER"));

// Exact-match lookup for the scan/SKU field.
posRouter.get("/lookup", async (req, res) => {
  const code = String(req.query.code || "");
  const item = await prisma.item.findFirst({
    where: { storeId: req.session!.storeId, sku: code, status: "AVAILABLE" },
    include: { account: { select: { name: true } } },
  });
  if (!item) return res.status(404).json({ error: "No available item with that SKU" });
  res.json(item);
});

// "Search Inventory" modal for tagless items (tasks 373b9ec4 / 1f21c808) — searches
// description/brand/category rather than requiring an exact code.
posRouter.get("/inventory-search", async (req, res) => {
  const { q, category, size, brand, page } = req.query;
  const pageNum = Math.max(1, Number(page) || 1);
  const pageSize = 20;
  const where = {
    storeId: req.session!.storeId,
    status: "AVAILABLE",
    ...(category ? { category: String(category) } : {}),
    ...(size ? { size: String(size) } : {}),
    ...(brand ? { brand: { contains: String(brand) } } : {}),
    ...(q
      ? {
          OR: [
            { description: { contains: String(q) } },
            { brand: { contains: String(q) } },
            { category: { contains: String(q) } },
          ],
        }
      : {}),
  };
  const [results, total] = await Promise.all([
    prisma.item.findMany({
      where,
      include: { account: { select: { name: true } } },
      orderBy: { intakeDate: "desc" },
      skip: (pageNum - 1) * pageSize,
      take: pageSize,
    }),
    prisma.item.count({ where }),
  ]);
  res.json({ results, total, page: pageNum, pageSize });
});

const checkoutItemSchema = z.object({ itemId: z.string(), salePrice: z.number().positive() });
const checkoutSchema = z.object({
  items: z.array(checkoutItemSchema).min(1),
  paymentType: z.enum(["CASH", "CARD", "STORE_CREDIT"]),
  registerName: z.string().optional(),
});

// Checkout: creates one Sale per cart line, flips each Item to SOLD, and credits the
// owning Account's balance by its split (skipped for DONOR/STORE accounts, matching
// "no payouts for Donors" from tasks.json's account-type task).
posRouter.post("/checkout", async (req, res) => {
  const parsed = checkoutSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const session = req.session!;

  const sales = [];
  for (const line of parsed.data.items) {
    const item = await prisma.item.findFirst({
      where: { id: line.itemId, storeId: session.storeId, status: "AVAILABLE" },
      include: { account: true },
    });
    if (!item) {
      return res.status(409).json({ error: `Item ${line.itemId} is not available for sale` });
    }

    const sale = await prisma.sale.create({
      data: {
        itemId: item.id,
        salePrice: line.salePrice,
        paymentType: parsed.data.paymentType,
        registerName: parsed.data.registerName,
        processedById: session.sub,
        storeId: session.storeId,
      },
    });

    await prisma.item.update({
      where: { id: item.id },
      data: {
        status: "SOLD",
        history: {
          create: [
            {
              changeType: "STATUS_CHANGE",
              oldValue: "AVAILABLE",
              newValue: "SOLD",
              changedById: session.sub,
              activeRole: session.activeRole,
            },
          ],
        },
      },
    });

    if (BALANCE_BEARING_ACCOUNT_TYPES.includes(item.account.accountType as AccountType)) {
      const splitPercent = item.account.splitPercent ?? 100;
      const consignorShare = (line.salePrice * splitPercent) / 100;
      await prisma.account.update({
        where: { id: item.account.id },
        data: { currentBalance: { increment: consignorShare } },
      });
    }

    await recordAudit(session, "Sale", sale.id, "CHECKOUT", { itemId: item.id, salePrice: line.salePrice });
    sales.push(sale);
  }

  res.status(201).json({ sales });
});
