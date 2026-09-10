import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { authenticate } from "../middleware/auth";
import { requireRole } from "../middleware/requireRole";
import { recordAudit } from "../lib/audit";
import { ACCOUNT_TYPES, BALANCE_BEARING_ACCOUNT_TYPES, type AccountType } from "../lib/enums";
import { serializeAccount } from "../services/accounts.service";

export const accountsRouter = Router();
accountsRouter.use(authenticate);

// Staff-only listing/management. Consignor/Vendor/Donor/BoothOwner sessions see their
// own account through /accounts/me instead (see accounts.routes "/me" below), never
// through this staff listing — that's the account-type/role screen split from
// app_flow_document.md.
accountsRouter.get("/", requireRole("SYSTEM_ADMIN", "OWNER", "MANAGER", "EMPLOYEE"), async (req, res) => {
  const { accountType } = req.query;
  const accounts = await prisma.account.findMany({
    where: {
      storeId: req.session!.storeId,
      ...(accountType ? { accountType: String(accountType) } : {}),
    },
    orderBy: { name: "asc" },
  });
  res.json(accounts.map(serializeAccount));
});

accountsRouter.get(
  "/:id",
  requireRole("SYSTEM_ADMIN", "OWNER", "MANAGER", "EMPLOYEE"),
  async (req, res) => {
    const account = await prisma.account.findFirst({
      where: { id: req.params.id, storeId: req.session!.storeId },
    });
    if (!account) return res.status(404).json({ error: "Account not found" });
    const items = await prisma.item.findMany({ where: { accountId: account.id }, orderBy: { intakeDate: "desc" } });
    const payouts = BALANCE_BEARING_ACCOUNT_TYPES.includes(account.accountType as AccountType)
      ? await prisma.payout.findMany({ where: { accountId: account.id }, orderBy: { createdAt: "desc" } })
      : [];
    res.json({ ...serializeAccount(account), items, payouts });
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
});

accountsRouter.post("/", requireRole("SYSTEM_ADMIN", "OWNER", "MANAGER"), async (req, res) => {
  const parsed = createAccountSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  if (parsed.data.accountType === "STORE") {
    return res.status(400).json({ error: "STORE accounts are managed automatically" });
  }
  const account = await prisma.account.create({
    data: { ...parsed.data, storeId: req.session!.storeId },
  });
  await recordAudit(req.session!, "Account", account.id, "CREATE", { accountType: account.accountType });
  res.status(201).json(serializeAccount(account));
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
    const parsed = payoutRequestSchema.safeParse(req.body);
    const amount = parsed.success && parsed.data.amount ? parsed.data.amount : account.currentBalance;
    if (amount <= 0) return res.status(400).json({ error: "No balance available to request" });
    const payout = await prisma.payout.create({ data: { accountId, amount, status: "REQUESTED" } });
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
    if (!BALANCE_BEARING_ACCOUNT_TYPES.includes(account.accountType as AccountType)) {
      return res.status(400).json({ error: `${account.accountType} accounts do not accrue payouts` });
    }
    const amount = account.currentBalance;
    if (amount <= 0) return res.status(400).json({ error: "No balance available" });
    const [payout] = await prisma.$transaction([
      prisma.payout.create({ data: { accountId: account.id, amount, status: "PAID", paidAt: new Date() } }),
      prisma.account.update({ where: { id: account.id }, data: { currentBalance: 0 } }),
    ]);
    await recordAudit(req.session!, "Payout", payout.id, "GENERATE_AND_PAY", { amount });
    res.status(201).json(payout);
  }
);
