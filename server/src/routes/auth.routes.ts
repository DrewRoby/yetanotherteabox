import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { authenticate } from "../middleware/auth";
import { beginSession, selectRole, verifyCredentials, loadRoleOptions, issueToken } from "../services/auth.service";
import { resolveBadge } from "../services/badge.service";
import { ROLES } from "../lib/enums";
import { signRoleSelectionTicket, verifyRoleSelectionTicket } from "../lib/jwt";

export const authRouter = Router();

// The two credential-adjacent, pre-auth endpoints — nothing stops unlimited password
// guessing against /login today, and /select-role is the second half of that same
// credential exchange (it redeems /login's role-selection ticket). Keyed by IP (the
// library's default), which is enough for a single-shop deployment; a real multi-
// tenant SaaS would want this keyed by email/userId as well to stop a distributed
// guess spread across IPs.
const credentialLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts. Try again later." },
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

authRouter.post("/login", credentialLimiter, async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const user = await verifyCredentials(parsed.data.email, parsed.data.password);
  if (!user) return res.status(401).json({ error: "Invalid email or password" });

  const result = await beginSession(user.id);
  if (!result.needsRoleSelection) {
    return res.json({ needsRoleSelection: false, token: result.token, activeRole: result.activeRole });
  }
  // No bare userId here: the ticket is the only thing /select-role will accept as
  // proof this caller just passed the password check.
  return res.json({ needsRoleSelection: true, ticket: signRoleSelectionTicket(user.id), roles: result.roles });
});

// Badge scans get their own, looser limiter: the server binds to 127.0.0.1 by
// default, so every register in a shop can share one IP, and a busy shift of quick
// badge logins would trip the 20/15min credential limit. Brute force isn't the
// concern it is for passwords — codes carry 100 random bits (badge.service.ts).
const badgeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts. Try again later." },
});

const badgeLoginSchema = z.object({
  code: z.string().min(1).max(64),
  role: z.enum(ROLES).optional(),
  storeId: z.string().optional(),
});

// Scan-to-login from a sign-in sheet badge. Mirrors /login's two-step shape, except
// the role-choice step re-sends the badge code instead of going through
// /select-role, so the second step still proves possession of the credential. Only
// BADGE_ROLES are ever offered or accepted — see badge.service.ts.
authRouter.post("/badge-login", badgeLimiter, async (req, res) => {
  const parsed = badgeLoginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const resolved = await resolveBadge(parsed.data.code);
  if (!resolved) return res.status(401).json({ error: "Badge not recognized" });
  const { user, roles } = resolved;

  let choice = roles.length === 1 ? roles[0] : undefined;
  if (parsed.data.role) {
    choice = roles.find((r) => r.role === parsed.data.role && (!parsed.data.storeId || r.storeId === parsed.data.storeId));
    if (!choice) return res.status(403).json({ error: "That role can't be used with a badge sign-in" });
  }
  if (!choice) return res.json({ needsRoleSelection: true, roles });

  return res.json({ needsRoleSelection: false, token: issueToken(user, choice), activeRole: choice.role });
});

const selectRoleSchema = z.object({
  ticket: z.string().min(1),
  role: z.enum(ROLES),
  storeId: z.string(),
});

// Second step of login when a user holds multiple roles — mirrors the login
// wireframe's role-picker grid. The user comes from /login's short-lived signed
// ticket, never from the request body — see signRoleSelectionTicket in lib/jwt.ts.
authRouter.post("/select-role", credentialLimiter, async (req, res) => {
  const parsed = selectRoleSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  let userId: string;
  try {
    userId = verifyRoleSelectionTicket(parsed.data.ticket);
  } catch {
    return res.status(401).json({ error: "Sign-in expired. Please sign in again." });
  }
  try {
    const token = await selectRole(userId, parsed.data.role, parsed.data.storeId);
    return res.json({ token, activeRole: parsed.data.role });
  } catch (err) {
    return res.status(403).json({ error: (err as Error).message });
  }
});

const switchRoleSchema = z.object({
  role: z.enum(ROLES),
  storeId: z.string(),
});

// Explicit "Switch Role" action (app_flow_document.md). Re-validates the CURRENT
// session's user actually holds the target role before minting a new token — a
// session can never talk itself into a role it wasn't granted.
authRouter.post("/switch-role", authenticate, async (req, res) => {
  const parsed = switchRoleSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const token = await selectRole(req.session!.sub, parsed.data.role, parsed.data.storeId);
    return res.json({ token, activeRole: parsed.data.role });
  } catch (err) {
    return res.status(403).json({ error: (err as Error).message });
  }
});

authRouter.get("/me", authenticate, async (req, res) => {
  const session = req.session!;
  const roles = await loadRoleOptions(session.sub);
  const store = await prisma.store.findUnique({ where: { id: session.storeId } });
  res.json({
    userId: session.sub,
    name: session.name,
    email: session.email,
    activeRole: session.activeRole,
    storeId: session.storeId,
    storeName: store?.name,
    accountId: session.accountId ?? null,
    availableRoles: roles,
  });
});
