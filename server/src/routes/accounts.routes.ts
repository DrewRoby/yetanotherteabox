import { Router } from "express";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { authenticate } from "../middleware/auth";
import { requireRole } from "../middleware/requireRole";
import { recordAudit, recordAuditMany } from "../lib/audit";
import { ACCOUNT_TYPES, BALANCE_BEARING_ACCOUNT_TYPES, ITEM_STATUSES, type AccountType } from "../lib/enums";
import { itemListQuerySchema, listItems } from "../services/itemList.service";
import { generatePaidPayout, isBalanceBearing, nextPayoutNumber, serializeAccount } from "../services/accounts.service";

export const accountsRouter = Router();
accountsRouter.use(authenticate);

// Date filters arrive as epoch ms — the client resolves local-day bounds.
const dateParam = z.coerce.number().int().transform((ms) => new Date(ms));

// Staff-only listing/management. Consignor/Vendor/Donor/BoothOwner sessions see their
// own account through /accounts/me instead (see accounts.routes "/me" below), never
// through this staff listing — that's the account-type/role screen split from
// app_flow_document.md.
accountsRouter.get("/", requireRole("SYSTEM_ADMIN", "OWNER", "MANAGER", "EMPLOYEE"), async (req, res) => {
  // ?accountType=STORE is the Store tab: the built-in STORE account plus every account
  // flagged isStoreAccount. Any other type excludes flagged accounts, so a store's
  // "2019 Inventory" bucket (a CONSIGNOR-type row) doesn't also show under Consignors.
  const accountType = req.query.accountType ? String(req.query.accountType) : undefined;
  const tabWhere: Prisma.AccountWhereInput =
    accountType === "STORE"
      ? { OR: [{ accountType: "STORE" }, { isStoreAccount: true }] }
      : accountType
        ? { accountType, isStoreAccount: false }
        : {};
  // ?status=active (default) | inactive | all — inactive (dormant) accounts stay out of
  // the default list and every account picker (which also call this endpoint).
  const status = req.query.status === "inactive" || req.query.status === "all" ? req.query.status : "active";
  if (status !== "all") tabWhere.isActive = status === "active";
  const accounts = await prisma.account.findMany({
    where: { storeId: req.session!.storeId, ...tabWhere },
    orderBy: { name: "asc" },
  });
  // Latest payout per account, computed live (~100ms over 55k migrated payouts, unlike
  // lastSaleAt — see server/CLAUDE.md). REJECTED = voided, not a payout that happened.
  const latestPayouts = await prisma.payout.groupBy({
    by: ["accountId"],
    where: {
      status: { not: "REJECTED" },
      account: { storeId: req.session!.storeId, ...tabWhere },
    },
    _max: { createdAt: true },
  });
  const lastPayoutAtByAccount = new Map(latestPayouts.map((p) => [p.accountId, p._max.createdAt]));
  // Latest intake per account: a correlated MAX riding the (accountId, intakeDate) index
  // (~30ms for ~3.6k accounts; Prisma's groupBy over Item took ~1.3s).
  const intakeRows = await prisma.$queryRaw<{ id: string; lastIntakeAt: bigint | number | null }[]>`
    SELECT a."id", (SELECT MAX(i."intakeDate") FROM "Item" i WHERE i."accountId" = a."id") AS "lastIntakeAt"
    FROM "Account" a WHERE a."storeId" = ${req.session!.storeId}`;
  const lastIntakeAtByAccount = new Map(
    intakeRows.map((r) => [r.id, r.lastIntakeAt == null ? null : new Date(Number(r.lastIntakeAt))])
  );
  res.json(
    accounts.map((a) => {
      const lastPayoutAt = lastPayoutAtByAccount.get(a.id) ?? null;
      const lastIntakeAt = lastIntakeAtByAccount.get(a.id) ?? null;
      // "Last activity" = latest intake, sale or payout — what the Accounts list's
      // "No activity since" filter (bulk deactivation of dormant accounts) keys on.
      const times = [lastIntakeAt, a.lastSaleAt, lastPayoutAt].filter((d): d is Date => d != null).map((d) => d.getTime());
      return {
        ...serializeAccount(a),
        lastPayoutAt,
        lastIntakeAt,
        lastActivityAt: times.length ? new Date(Math.max(...times)) : null,
      };
    })
  );
});

accountsRouter.get(
  "/:id",
  requireRole("SYSTEM_ADMIN", "OWNER", "MANAGER", "EMPLOYEE"),
  async (req, res) => {
    const account = await prisma.account.findFirst({
      where: { id: req.params.id, storeId: req.session!.storeId },
    });
    if (!account) return res.status(404).json({ error: "Account not found" });
    // Items themselves come from GET /:id/items (filtered/sorted/paged) — a migrated
    // STORE account owns ~340k of them, far too many to inline here.
    const itemCount = await prisma.item.count({ where: { accountId: account.id } });
    // Payouts likewise come from GET /:id/payouts (filtered/paged; the busiest migrated
    // consignor has ~1,000). Counted for every account: one flagged isStoreAccount after
    // the fact (or migrated that way) keeps the payout history it had before.
    const payoutCount = await prisma.payout.count({ where: { accountId: account.id } });
    res.json({ ...serializeAccount(account), itemCount, payoutCount });
  }
);

const payoutsQuerySchema = z.object({
  q: z.string().trim().min(1).optional(), // matches payouts containing an item whose description includes it
  from: dateParam.optional(), // epoch ms, inclusive — the client resolves local-day bounds
  to: dateParam.optional(), // exclusive
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(5),
});

// The account detail page's Payout History, newest first.
accountsRouter.get(
  "/:id/payouts",
  requireRole("SYSTEM_ADMIN", "OWNER", "MANAGER", "EMPLOYEE"),
  async (req, res) => {
    const parsed = payoutsQuerySchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const account = await prisma.account.findFirst({
      where: { id: req.params.id, storeId: req.session!.storeId },
      select: { id: true },
    });
    if (!account) return res.status(404).json({ error: "Account not found" });
    const { q, from, to, page, pageSize } = parsed.data;
    const needle = q?.toLowerCase();
    // Search runs as one join scoped to this account's payouts first: Prisma's
    // `lines: { some: { item: ... } }` compiles to a subquery over every PayoutLine in
    // the store (~7s on migrated data) instead of ~20ms here.
    const matchingPayoutIds = needle
      ? (
          await prisma.$queryRaw<{ payoutId: string }[]>`
            SELECT DISTINCT l."payoutId" FROM "Payout" p
            JOIN "PayoutLine" l ON l."payoutId" = p."id"
            JOIN "Item" i ON i."id" = l."itemId"
            WHERE p."accountId" = ${account.id} AND instr(lower(i."description"), ${needle}) > 0`
        ).map((r) => r.payoutId)
      : null;
    const where: Prisma.PayoutWhereInput = {
      accountId: account.id,
      ...(from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) } } : {}),
      ...(matchingPayoutIds ? { id: { in: matchingPayoutIds } } : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.payout.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { payoutNumber: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { lines: { where: { itemId: { not: null } }, select: { item: { select: { description: true } } } } },
      }),
      prisma.payout.count({ where }),
    ]);
    res.json({
      total,
      page,
      pageSize,
      payouts: rows.map(({ lines, ...p }) => ({
        ...p,
        itemCount: lines.length,
        // How many of this payout's items matched the search (null when not searching).
        matchCount: needle ? lines.filter((l) => l.item?.description.toLowerCase().includes(needle)).length : null,
      })),
    });
  }
);

// The account detail page's Items table — services/itemList.service.ts, scoped to the account.
accountsRouter.get(
  "/:id/items",
  requireRole("SYSTEM_ADMIN", "OWNER", "MANAGER", "EMPLOYEE"),
  async (req, res) => {
    const parsed = itemListQuerySchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const account = await prisma.account.findFirst({
      where: { id: req.params.id, storeId: req.session!.storeId },
      select: { id: true },
    });
    if (!account) return res.status(404).json({ error: "Account not found" });
    const { query, page, pageSize } = parsed.data;
    const result = await listItems({ storeId: req.session!.storeId, accountId: account.id }, query);
    res.json({ ...result, page, pageSize });
  }
);

// One payout, itemized: every PayoutLine with its item and (if linked) sale.
accountsRouter.get(
  "/:id/payouts/:payoutId",
  requireRole("SYSTEM_ADMIN", "OWNER", "MANAGER", "EMPLOYEE"),
  async (req, res) => {
    const payout = await prisma.payout.findFirst({
      where: { id: req.params.payoutId, accountId: req.params.id, account: { storeId: req.session!.storeId } },
      include: {
        account: { select: { id: true, name: true, accountType: true } },
        lines: {
          include: {
            item: { select: { id: true, sku: true, description: true, category: true, size: true, price: true } },
            sale: { select: { id: true, saleDate: true, salePrice: true } },
          },
        },
      },
    });
    if (!payout) return res.status(404).json({ error: "Payout not found" });
    // Chronological by sale where there is one; unattached lines (adjustments) last.
    payout.lines.sort(
      (a, b) =>
        (a.sale?.saleDate.getTime() ?? Infinity) - (b.sale?.saleDate.getTime() ?? Infinity) ||
        a.lineType.localeCompare(b.lineType)
    );
    res.json(payout);
  }
);

// Self-service: whatever account the caller's active role is scoped to (Consignor,
// Vendor, Donor, Booth Owner). Used by the Consignor Portal / Booth Owner Pricing
// pages. Deliberately ignores :id entirely — a Consignor session can only ever see
// the one account baked into their own token.
accountsRouter.get(
  "/me/profile",
  requireRole("CONSIGNOR", "VENDOR", "DONOR", "BOOTH_OWNER"),
  async (req, res) => {
    const accountId = req.session!.accountId;
    if (!accountId) return res.status(403).json({ error: "Session has no linked account" });
    const account = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
    const items = await prisma.item.findMany({ where: { accountId }, orderBy: { intakeDate: "desc" } });
    const payouts = await prisma.payout.findMany({ where: { accountId }, orderBy: { createdAt: "desc" } });
    res.json({ ...serializeAccount(account), items, payouts });
  }
);

const createAccountSchema = z.object({
  accountType: z.enum(ACCOUNT_TYPES),
  name: z.string().min(1),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  splitPercent: z.number().min(0).max(100).optional(),
  isStoreAccount: z.boolean().optional(),
});

accountsRouter.post("/", requireRole("SYSTEM_ADMIN", "OWNER", "MANAGER"), async (req, res) => {
  const parsed = createAccountSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  if (parsed.data.accountType === "STORE") {
    return res.status(400).json({ error: "STORE accounts are managed automatically" });
  }
  if (parsed.data.isStoreAccount && !BALANCE_BEARING_ACCOUNT_TYPES.includes(parsed.data.accountType)) {
    return res.status(400).json({ error: `${parsed.data.accountType} accounts can't be flagged as store accounts` });
  }
  const account = await prisma.account.create({
    data: { ...parsed.data, storeId: req.session!.storeId },
  });
  await recordAudit(req.session!, "Account", account.id, "CREATE", {
    accountType: account.accountType,
    isStoreAccount: account.isStoreAccount,
  });
  res.status(201).json(serializeAccount(account));
});

const updateAccountSchema = z
  .object({ isStoreAccount: z.boolean().optional(), isActive: z.boolean().optional() })
  .refine((v) => v.isStoreAccount !== undefined || v.isActive !== undefined, "Nothing to update");

// Account flags (Owner/Manager/Admin, each change audited):
// - isStoreAccount: store-owned rules (no balance credits, no payouts — see
//   isBalanceBearing). Only for the balance-bearing types; the built-in STORE account
//   and DONOR accounts are already never owed money. Flagging is refused while money
//   is still owed: an account can't go from "we owe $X" to "nobody is owed anything"
//   without a payout recording where that money went.
// - isActive: false = dormant (hidden from default lists and pickers, left out of
//   payout-obligation totals, no new intake). The balance is untouched, so
//   deactivating needs no such guard. Any account but the built-in STORE one.
accountsRouter.patch("/:id", requireRole("SYSTEM_ADMIN", "OWNER", "MANAGER"), async (req, res) => {
  const parsed = updateAccountSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const account = await prisma.account.findFirst({ where: { id: req.params.id, storeId: req.session!.storeId } });
  if (!account) return res.status(404).json({ error: "Account not found" });
  const { isStoreAccount, isActive } = parsed.data;
  const data: Prisma.AccountUpdateInput = {};

  if (isStoreAccount !== undefined && isStoreAccount !== account.isStoreAccount) {
    if (!BALANCE_BEARING_ACCOUNT_TYPES.includes(account.accountType as AccountType)) {
      return res.status(400).json({ error: `${account.accountType} accounts can't be flagged as store accounts` });
    }
    if (isStoreAccount && Math.abs(account.currentBalance) >= 0.005) {
      return res.status(409).json({
        error: `This account still has a balance of ${account.currentBalance.toFixed(2)}. Pay it out before marking it as a store account.`,
      });
    }
    data.isStoreAccount = isStoreAccount;
  }
  if (isActive !== undefined && isActive !== account.isActive) {
    if (account.accountType === "STORE") {
      return res.status(400).json({ error: "The store's own built-in account can't be made inactive" });
    }
    data.isActive = isActive;
  }
  if (Object.keys(data).length === 0) return res.json(serializeAccount(account));

  const updated = await prisma.account.update({ where: { id: account.id }, data });
  if (data.isStoreAccount !== undefined) {
    await recordAudit(req.session!, "Account", account.id, isStoreAccount ? "FLAG_STORE_ACCOUNT" : "UNFLAG_STORE_ACCOUNT", {});
  }
  if (data.isActive !== undefined) {
    await recordAudit(req.session!, "Account", account.id, isActive ? "REACTIVATE" : "DEACTIVATE", {
      currentBalance: account.currentBalance,
    });
  }
  res.json(serializeAccount(updated));
});

const bulkStatusSchema = z.object({
  accountIds: z.array(z.string().min(1)).min(1).max(10000),
  isActive: z.boolean(),
});

// Bulk activate/deactivate — the Accounts list's select mode. Same rules as
// PATCH /:id { isActive } (built-in STORE account is skipped, never deactivated), one
// audit entry per account changed. Ids from another store are refused outright.
accountsRouter.post("/bulk-status", requireRole("SYSTEM_ADMIN", "OWNER", "MANAGER"), async (req, res) => {
  const parsed = bulkStatusSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { isActive } = parsed.data;
  const ids = [...new Set(parsed.data.accountIds)];
  const accounts = await prisma.account.findMany({
    where: { id: { in: ids }, storeId: req.session!.storeId },
    select: { id: true, accountType: true, isActive: true, currentBalance: true },
  });
  if (accounts.length !== ids.length) {
    return res.status(400).json({ error: "One or more accounts don't belong to this store" });
  }
  const toChange = accounts.filter((a) => a.accountType !== "STORE" && a.isActive !== isActive);
  await prisma.$transaction(async (tx) => {
    await tx.account.updateMany({ where: { id: { in: toChange.map((a) => a.id) } }, data: { isActive } });
  });
  await recordAuditMany(
    req.session!,
    "Account",
    toChange.map((a) => ({
      entityId: a.id,
      action: isActive ? "REACTIVATE" : "DEACTIVATE",
      details: { bulk: true, currentBalance: a.currentBalance },
    }))
  );
  res.json({
    updated: toChange.length,
    unchanged: accounts.length - toChange.length, // already in that state, or the built-in STORE account
  });
});

const payoutRequestSchema = z.object({ amount: z.number().positive().optional() });

// A Consignor/Vendor/BoothOwner requesting their own payout.
accountsRouter.post(
  "/me/payouts",
  requireRole("CONSIGNOR", "VENDOR", "BOOTH_OWNER"),
  async (req, res) => {
    const accountId = req.session!.accountId;
    if (!accountId) return res.status(403).json({ error: "Session has no linked account" });
    const account = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
    if (!isBalanceBearing(account)) return res.status(400).json({ error: "This account does not accrue payouts" });
    const parsed = payoutRequestSchema.safeParse(req.body);
    const amount = parsed.success && parsed.data.amount ? parsed.data.amount : account.currentBalance;
    if (amount <= 0) return res.status(400).json({ error: "No balance available to request" });
    const payout = await prisma.$transaction(async (tx) =>
      tx.payout.create({ data: { payoutNumber: await nextPayoutNumber(tx), accountId, amount, status: "REQUESTED" } })
    );
    await recordAudit(req.session!, "Payout", payout.id, "REQUEST", { amount });
    res.status(201).json(payout);
  }
);

// Staff generating/approving a payout on behalf of an account.
accountsRouter.post(
  "/:id/payouts",
  requireRole("SYSTEM_ADMIN", "OWNER", "MANAGER"),
  async (req, res) => {
    const account = await prisma.account.findFirst({
      where: { id: req.params.id, storeId: req.session!.storeId },
    });
    if (!account) return res.status(404).json({ error: "Account not found" });
    if (!isBalanceBearing(account)) {
      return res.status(400).json({
        error: account.isStoreAccount ? "Store accounts do not accrue payouts" : `${account.accountType} accounts do not accrue payouts`,
      });
    }
    const amount = account.currentBalance;
    if (amount <= 0) return res.status(400).json({ error: "No balance available" });
    const payout = await generatePaidPayout(account);
    await recordAudit(req.session!, "Payout", payout.id, "GENERATE_AND_PAY", { amount });
    res.status(201).json(payout);
  }
);
