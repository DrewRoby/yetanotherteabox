import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { authenticate } from "../middleware/auth";
import { requireRole } from "../middleware/requireRole";
import { recordAudit } from "../lib/audit";
import { ROLES } from "../lib/enums";
import { inviteUser } from "../services/users.service";
import { testPrinterConnection } from "../adapters/printer";
import { runHeartbeatSync } from "../adapters/cloudSync";

export const settingsRouter = Router();
settingsRouter.use(authenticate);

// ---- Profile ----
const profileSchema = z.object({
  name: z.string().min(1).optional(),
  password: z.string().min(8).optional(),
});
settingsRouter.put("/profile", async (req, res) => {
  const parsed = profileSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const data: { name?: string; passwordHash?: string } = {};
  if (parsed.data.name) data.name = parsed.data.name;
  if (parsed.data.password) data.passwordHash = await bcrypt.hash(parsed.data.password, 10);
  const user = await prisma.user.update({ where: { id: req.session!.sub }, data });
  res.json({ id: user.id, name: user.name, email: user.email });
});

// ---- Users & Permissions (Owner/Admin only) ----
settingsRouter.get("/users", requireRole("SYSTEM_ADMIN", "OWNER"), async (req, res) => {
  const roles = await prisma.userRole.findMany({
    where: { storeId: req.session!.storeId },
    include: { user: { select: { id: true, email: true, name: true } }, account: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
  });
  res.json(roles);
});

const inviteSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  role: z.enum(ROLES),
  accountName: z.string().optional(),
  splitPercent: z.number().min(0).max(100).optional(),
});
settingsRouter.post("/users/invite", requireRole("SYSTEM_ADMIN", "OWNER"), async (req, res) => {
  const parsed = inviteSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const result = await inviteUser({ storeId: req.session!.storeId, ...parsed.data });
  await recordAudit(req.session!, "User", result.user.id, "INVITE", { role: parsed.data.role });
  res.status(201).json({
    userId: result.user.id,
    email: result.user.email,
    role: result.userRole.role,
    tempPassword: result.tempPassword,
  });
});

settingsRouter.delete("/users/roles/:userRoleId", requireRole("SYSTEM_ADMIN", "OWNER"), async (req, res) => {
  const userRole = await prisma.userRole.findFirst({
    where: { id: req.params.userRoleId, storeId: req.session!.storeId },
  });
  if (!userRole) return res.status(404).json({ error: "Role grant not found" });
  await prisma.userRole.delete({ where: { id: userRole.id } });
  await recordAudit(req.session!, "UserRole", userRole.id, "REVOKE", { role: userRole.role });
  res.status(204).send();
});

// ---- Devices / Hardware ----
settingsRouter.get("/devices", requireRole("SYSTEM_ADMIN", "OWNER", "MANAGER"), async (req, res) => {
  const devices = await prisma.device.findMany({ where: { storeId: req.session!.storeId } });
  res.json(devices);
});

const deviceSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["PRINTER", "SCANNER", "CASH_DRAWER", "PAYMENT_TERMINAL"]),
  connectionInfo: z.string().optional(),
});
settingsRouter.post("/devices", requireRole("SYSTEM_ADMIN", "OWNER", "MANAGER"), async (req, res) => {
  const parsed = deviceSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const device = await prisma.device.create({
    data: { ...parsed.data, storeId: req.session!.storeId, status: "DISCONNECTED" },
  });
  res.status(201).json(device);
});

settingsRouter.post(
  "/devices/:id/test-connection",
  requireRole("SYSTEM_ADMIN", "OWNER", "MANAGER"),
  async (req, res) => {
    const device = await prisma.device.findFirst({ where: { id: req.params.id, storeId: req.session!.storeId } });
    if (!device) return res.status(404).json({ error: "Device not found" });
    const result = device.type === "PRINTER" ? await testPrinterConnection() : { online: true, device: device.name };
    const updated = await prisma.device.update({
      where: { id: device.id },
      data: { status: result.online ? "CONNECTED" : "DISCONNECTED" },
    });
    res.json({ device: updated, testResult: result });
  }
);

// ---- Cloud Vault / System Sync ----
settingsRouter.get("/sync/heartbeat", requireRole("SYSTEM_ADMIN", "OWNER", "MANAGER"), async (req, res) => {
  const heartbeat = await prisma.heartbeat.findUnique({ where: { storeId: req.session!.storeId } });
  res.json({ lastSyncedAt: heartbeat?.lastSyncedAt ?? null });
});

settingsRouter.post("/sync/heartbeat", requireRole("SYSTEM_ADMIN", "OWNER", "MANAGER"), async (req, res) => {
  const result = await runHeartbeatSync(req.session!.storeId);
  res.json(result);
});
