import { Router } from "express";
import { prisma } from "../lib/prisma";
import { authenticate } from "../middleware/auth";
import { requireRole } from "../middleware/requireRole";
import { Prisma } from "@prisma/client";
import { BALANCE_BEARING_WHERE } from "../services/accounts.service";
import { loadPrintableItems, printItemsAsJob } from "../services/printJobs.service";
import {
  addDays,
  dayDetail,
  localDateKey,
  parseLocalDate,
  salesLedger,
  salesPeriods,
  startOfLocalDay,
} from "../services/salesReport.service";
import { z } from "zod";
import { recordAudit } from "../lib/audit";
import { issueBadges, listBadgeEligibleUsers, revokeBadge } from "../services/badge.service";

export const reportsRouter = Router();
reportsRouter.use(authenticate);

// Dashboard widgets — role-specific per app_flow_document.md (Owner sees payouts/
// heartbeat, Manager sees low stock/pending intake, Employee sees quick links only).
reportsRouter.get(
  "/dashboard",
  requireRole("SYSTEM_ADMIN", "OWNER", "MANAGER", "EMPLOYEE"),
  async (req, res) => {
    const storeId = req.session!.storeId;
    const [totalInventory, todaySales, pendingIntake, accounts, heartbeat] = await Promise.all([
      prisma.item.count({ where: { storeId, status: "AVAILABLE" } }),
      prisma.sale.aggregate({
        where: { storeId, saleDate: { gte: startOfLocalDay(new Date()) } },
        _sum: { salePrice: true },
        _count: true,
      }),
      prisma.item.count({ where: { storeId, status: "PENDING" } }),
      // Outstanding payout obligations: active accounts only — a dormant (inactive)
      // account's balance is kept on the account but not counted as owed here.
      prisma.account.findMany({ where: { storeId, ...BALANCE_BEARING_WHERE, isActive: true } }),
      prisma.heartbeat.findUnique({ where: { storeId } }),
    ]);
    const pendingPayoutTotal = accounts.reduce((sum, a) => sum + a.currentBalance, 0);
    const recentSales = await prisma.sale.findMany({
      where: { storeId },
      orderBy: { saleDate: "desc" },
      take: 5,
      include: { item: { include: { account: true } } },
    });
    res.json({
      totalInventory,
      dailySalesTotal: todaySales._sum.salePrice ?? 0,
      dailySalesCount: todaySales._count,
      pendingIntake,
      pendingPayoutTotal,
      activeAccounts: accounts.length,
      lastSyncedAt: heartbeat?.lastSyncedAt ?? null,
      recentSales: recentSales.map((s) => ({
        id: s.id,
        description: s.item.description,
        accountName: s.item.account.name,
        salePrice: s.salePrice,
        saleDate: s.saleDate,
      })),
    });
  }
);

const REPORT_ROLES = ["SYSTEM_ADMIN", "OWNER", "MANAGER"] as const;
const LEDGER_DAYS = [7, 14, 30, 60, 90];

// ?date=YYYY-MM-DD (server-local day; default today) and ?days= (ledger length).
function summaryParams(query: Record<string, unknown>) {
  const asOf = parseLocalDate(query.date) ?? startOfLocalDay(new Date());
  const requested = Number(query.days) || 14;
  const days = LEDGER_DAYS.includes(requested) ? requested : 14;
  return { asOf, days };
}

// Daily Sales Summary: the day / week-to-date / year-to-date comparables (each vs last
// year) plus a per-day ledger with each day's YoY comparable. See salesReport.service.ts.
reportsRouter.get("/sales-summary", requireRole(...REPORT_ROLES), async (req, res) => {
  const { asOf, days } = summaryParams(req.query);
  const storeId = req.session!.storeId;
  const [periods, ledger] = await Promise.all([salesPeriods(storeId, asOf), salesLedger(storeId, asOf, days)]);
  res.json({ asOf: localDateKey(asOf), days, periods, ledger });
});

reportsRouter.get("/sales-summary/export.csv", requireRole(...REPORT_ROLES), async (req, res) => {
  const { asOf, days } = summaryParams(req.query);
  const rows = await salesLedger(req.session!.storeId, asOf, days);
  const cols = ["transactions", "itemsSold", "grossSales", "inventoryAdded", "itemsAdded", "payouts", "payoutCount"] as const;
  const money = new Set(["grossSales", "inventoryAdded", "payouts"]);
  const fmt = (k: string, v: number) => (money.has(k) ? v.toFixed(2) : String(v));
  const snake = (k: string) => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
  const header = ["date", ...cols.map(snake), "ly_date", ...cols.map((c) => `ly_${snake(c)}`)].join(",");
  const lines = rows.map((r) =>
    [r.date, ...cols.map((c) => fmt(c, r.current[c])), r.lastYearDate, ...cols.map((c) => fmt(c, r.lastYear[c]))].join(",")
  );
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename=daily-sales-${localDateKey(asOf)}.csv`);
  res.send([header, ...lines].join("\n"));
});

// Day Detail: everything sold, taken in, repriced, tag-printed and paid out on one day.
reportsRouter.get("/day-detail", requireRole(...REPORT_ROLES), async (req, res) => {
  const day = parseLocalDate(req.query.date) ?? startOfLocalDay(new Date());
  res.json(await dayDetail(req.session!.storeId, day));
});

// ---- Print Queues (every tag print run — see services/printJobs.service.ts) ----
const printJobListSchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  q: z.string().trim().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

reportsRouter.get("/print-jobs", requireRole(...REPORT_ROLES), async (req, res) => {
  const parsed = printJobListSchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { q, page, pageSize } = parsed.data;
  const from = parseLocalDate(parsed.data.from);
  const to = parseLocalDate(parsed.data.to);
  const where: Prisma.PrintJobWhereInput = {
    storeId: req.session!.storeId,
    ...(from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lt: addDays(to, 1) } : {}) } } : {}),
    ...(q ? { items: { some: { OR: [{ sku: { contains: q } }, { description: { contains: q } }] } } } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.printJob.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        createdAt: true,
        source: true,
        itemCount: true,
        activeRole: true,
        reprintOfId: true,
        createdBy: { select: { name: true } },
        items: { orderBy: { position: "asc" }, take: 3, select: { sku: true, description: true } },
      },
    }),
    prisma.printJob.count({ where }),
  ]);
  res.json({ rows, total, page, pageSize });
});

reportsRouter.get("/print-jobs/:id", requireRole(...REPORT_ROLES), async (req, res) => {
  const job = await prisma.printJob.findFirst({
    where: { id: req.params.id, storeId: req.session!.storeId },
    include: {
      createdBy: { select: { name: true } },
      reprintOf: { select: { id: true, createdAt: true } },
      reprints: { orderBy: { createdAt: "asc" }, select: { id: true, createdAt: true, itemCount: true } },
      items: {
        orderBy: { position: "asc" },
        // Current item state alongside the snapshot, so the page can flag tags whose
        // price/description changed since they were printed.
        include: { item: { select: { id: true, sku: true, description: true, price: true, status: true, category: true, size: true } } },
      },
    },
  });
  if (!job) return res.status(404).json({ error: "Print job not found" });
  res.json(job);
});

const reprintSchema = z.object({ printJobItemIds: z.array(z.string()).min(1).optional() });

// Reprints a past job (all of it, or the chosen lines) as a new job with the items'
// CURRENT data — a repriced item gets its new price on the new tag. Lines whose item
// has since been deleted are skipped.
reportsRouter.post("/print-jobs/:id/reprint", requireRole(...REPORT_ROLES), async (req, res) => {
  const parsed = reprintSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const session = req.session!;
  const job = await prisma.printJob.findFirst({
    where: { id: req.params.id, storeId: session.storeId },
    include: { items: { orderBy: { position: "asc" } } },
  });
  if (!job) return res.status(404).json({ error: "Print job not found" });
  const wanted = parsed.data.printJobItemIds ? new Set(parsed.data.printJobItemIds) : null;
  const lines = job.items.filter((l) => !wanted || wanted.has(l.id));
  const itemIds = lines.flatMap((l) => (l.itemId ? [l.itemId] : []));
  if (itemIds.length === 0) return res.status(400).json({ error: "None of these tags' items exist anymore" });
  const items = await loadPrintableItems(session, itemIds);
  if (!items) return res.status(400).json({ error: "Some of these items are no longer in this store" });
  const { job: reprint } = await printItemsAsJob(session, items, "REPRINT", job.id);
  res.status(201).json({ printJobId: reprint.id, printed: items.length, skipped: lines.length - itemIds.length });
});

// ---- Employee Sign-In Sheet (scan-to-login badges) ----
// Lists staff with a badge-eligible role; issuing returns plaintext codes exactly
// once, for the web to render onto the printable sheet. See badge.service.ts for why
// codes are hashed at rest and which roles a badge may unlock.
reportsRouter.get(
  "/sign-in-sheet",
  requireRole("SYSTEM_ADMIN", "OWNER", "MANAGER"),
  async (req, res) => {
    res.json(await listBadgeEligibleUsers(req.session!.storeId));
  }
);

const issueBadgesSchema = z.object({ userIds: z.array(z.string()).min(1).max(200) });

reportsRouter.post(
  "/sign-in-sheet/issue",
  requireRole("SYSTEM_ADMIN", "OWNER", "MANAGER"),
  async (req, res) => {
    const parsed = issueBadgesSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const issued = await issueBadges(req.session!.storeId, parsed.data.userIds);
    for (const b of issued) {
      await recordAudit(req.session!, "User", b.userId, "ISSUE_BADGE", { roles: b.roles });
    }
    res.json(issued);
  }
);

reportsRouter.delete(
  "/sign-in-sheet/:userId",
  requireRole("SYSTEM_ADMIN", "OWNER", "MANAGER"),
  async (req, res) => {
    const ok = await revokeBadge(req.session!.storeId, req.params.userId);
    if (!ok) return res.status(404).json({ error: "User not found" });
    await recordAudit(req.session!, "User", req.params.userId, "REVOKE_BADGE");
    res.status(204).send();
  }
);
