import { Router } from "express";
import { prisma } from "../lib/prisma";
import { authenticate } from "../middleware/auth";
import { requireRole } from "../middleware/requireRole";
import { BALANCE_BEARING_ACCOUNT_TYPES, type AccountType } from "../lib/enums";

export const reportsRouter = Router();
reportsRouter.use(authenticate);

function startOfDay(d: Date) {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

// "YYYY-MM-DD" in the SERVER's local calendar day, not UTC. Using toISOString() here
// would key "today" by the UTC date, which can differ from the local date used to
// build the bucket boundaries (e.g. server in UTC-5 just after UTC midnight) — a sale
// made moments ago would silently be dropped from every bucket. Bucket generation and
// sale classification must use the same notion of "day", so both go through this.
function localDateKey(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

async function dailySales(storeId: string, days: number) {
  const since = startOfDay(new Date());
  since.setDate(since.getDate() - (days - 1));
  const sales = await prisma.sale.findMany({
    where: { storeId, saleDate: { gte: since } },
    select: { saleDate: true, salePrice: true },
  });
  const buckets = new Map<string, { transactions: number; grossSales: number }>();
  for (let i = 0; i < days; i++) {
    const d = new Date(since);
    d.setDate(d.getDate() + i);
    buckets.set(localDateKey(d), { transactions: 0, grossSales: 0 });
  }
  for (const sale of sales) {
    const key = localDateKey(sale.saleDate);
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.transactions += 1;
      bucket.grossSales += sale.salePrice;
    }
  }
  return Array.from(buckets.entries())
    .map(([date, v]) => ({ date, ...v }))
    .reverse();
}

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
        where: { storeId, saleDate: { gte: startOfDay(new Date()) } },
        _sum: { salePrice: true },
        _count: true,
      }),
      prisma.item.count({ where: { storeId, status: "PENDING" } }),
      prisma.account.findMany({ where: { storeId, accountType: { in: BALANCE_BEARING_ACCOUNT_TYPES as string[] } } }),
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

reportsRouter.get(
  "/daily-sales",
  requireRole("SYSTEM_ADMIN", "OWNER", "MANAGER"),
  async (req, res) => {
    const days = Math.min(90, Math.max(1, Number(req.query.days) || 14));
    res.json(await dailySales(req.session!.storeId, days));
  }
);

reportsRouter.get(
  "/daily-sales/export.csv",
  requireRole("SYSTEM_ADMIN", "OWNER", "MANAGER"),
  async (req, res) => {
    const days = Math.min(90, Math.max(1, Number(req.query.days) || 14));
    const rows = await dailySales(req.session!.storeId, days);
    const csv = ["date,transactions,gross_sales", ...rows.map((r) => `${r.date},${r.transactions},${r.grossSales.toFixed(2)}`)].join("\n");
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=daily-sales.csv");
    res.send(csv);
  }
);

// Inventory Aging — bucketed by days since intake, AVAILABLE items only.
reportsRouter.get(
  "/inventory-aging",
  requireRole("SYSTEM_ADMIN", "OWNER", "MANAGER"),
  async (req, res) => {
    const items = await prisma.item.findMany({
      where: { storeId: req.session!.storeId, status: "AVAILABLE" },
      select: { id: true, sku: true, description: true, intakeDate: true, price: true },
    });
    const now = Date.now();
    const buckets = { "0-30": 0, "31-60": 0, "61-90": 0, "90+": 0 } as Record<string, number>;
    const aged90Plus: typeof items = [];
    for (const item of items) {
      const days = Math.floor((now - item.intakeDate.getTime()) / (1000 * 60 * 60 * 24));
      if (days <= 30) buckets["0-30"]++;
      else if (days <= 60) buckets["31-60"]++;
      else if (days <= 90) buckets["61-90"]++;
      else {
        buckets["90+"]++;
        aged90Plus.push(item);
      }
    }
    res.json({ buckets, aged90Plus });
  }
);

// Consignor payout statements — every balance-bearing account with a nonzero balance.
reportsRouter.get(
  "/payouts",
  requireRole("SYSTEM_ADMIN", "OWNER", "MANAGER"),
  async (req, res) => {
    const accounts = await prisma.account.findMany({
      where: {
        storeId: req.session!.storeId,
        accountType: { in: BALANCE_BEARING_ACCOUNT_TYPES as string[] },
      },
      orderBy: { currentBalance: "desc" },
    });
    res.json(accounts);
  }
);
