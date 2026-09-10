import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { authenticate } from "../middleware/auth";
import { beginSession, selectRole, verifyCredentials, loadRoleOptions } from "../services/auth.service";
import { ROLES } from "../lib/enums";

export const authRouter = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

authRouter.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const user = await verifyCredentials(parsed.data.email, parsed.data.password);
  if (!user) return res.status(401).json({ error: "Invalid email or password" });

  const result = await beginSession(user.id);
  if (!result.needsRoleSelection) {
    return res.json({ needsRoleSelection: false, token: result.token, activeRole: result.activeRole });
  }
  return res.json({ needsRoleSelection: true, userId: user.id, roles: result.roles });
});

const selectRoleSchema = z.object({
  userId: z.string(),
  role: z.enum(ROLES),
  storeId: z.string(),
});

// Second step of login when a user holds multiple roles — mirrors the login
// wireframe's role-picker grid. Also reused by /switch-role below.
authRouter.post("/select-role", async (req, res) => {
  const parsed = selectRoleSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const token = await selectRole(parsed.data.userId, parsed.data.role, parsed.data.storeId);
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
