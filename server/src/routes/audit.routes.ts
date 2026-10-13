import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../middleware/auth";
import { requireRole } from "../middleware/requireRole";
import { AUDIT_LABELS } from "../lib/enums";
import {
  DIMENSION_KEYS,
  applyLabel,
  auditItems,
  auditSummary,
  obligations,
  setLabel,
  type Dimension,
  type Filters,
} from "../services/inventoryAudit.service";

// Inventory Audit — see services/inventoryAudit.service.ts. Manager/Owner/Admin.
export const auditRouter = Router();
auditRouter.use(authenticate);
auditRouter.use(requireRole("SYSTEM_ADMIN", "OWNER", "MANAGER"));

// Filters come as one query param per dimension, comma-separated values
// (?age=1-3y,3y%2B&owner=consigned), plus q (search) and accountId.
function parseFilters(src: Record<string, unknown>): Filters {
  const filters: Filters = {};
  for (const key of DIMENSION_KEYS) {
    const raw = src[key];
    if (typeof raw === "string" && raw) filters[key] = raw.split(",").slice(0, 100);
    else if (Array.isArray(raw)) filters[key] = raw.map(String).slice(0, 100);
  }
  if (typeof src.q === "string" && src.q.trim()) filters.q = src.q.trim();
  if (typeof src.accountId === "string" && src.accountId) filters.accountId = src.accountId;
  return filters;
}

const dimension = z.enum(DIMENSION_KEYS as [Dimension, ...Dimension[]]);

auditRouter.get("/summary", async (req, res) => {
  const groupBy = dimension.catch("age").parse(req.query.groupBy);
  res.json(await auditSummary(req.session!.storeId, parseFilters(req.query), groupBy));
});

const itemsQuery = z.object({
  sort: z.enum(["intake", "price", "sku", "account", "category"]).default("intake"),
  dir: z.enum(["asc", "desc"]).default("asc"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

auditRouter.get("/items", async (req, res) => {
  const parsed = itemsQuery.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  res.json(await auditItems(req.session!.storeId, parseFilters(req.query), parsed.data));
});

const labelSchema = z.object({
  label: z.enum(AUDIT_LABELS).nullable(),
  itemIds: z.array(z.string()).min(1).max(50000).optional(),
  filters: z.record(z.unknown()).optional(),
});

// Label explicit items, or every item matching `filters` (same shape as the GET query).
auditRouter.post("/label", async (req, res) => {
  const parsed = labelSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { label, itemIds, filters } = parsed.data;
  if (!itemIds && !filters) return res.status(400).json({ error: "Give itemIds or filters" });
  const target = itemIds ? { itemIds } : { filters: parseFilters(filters!) };
  res.json(await setLabel(req.session!, target, label));
});

// Applying is the step that changes items — Owner/Admin only, like other bulk
// decisions about consignors' property.
auditRouter.post("/apply", requireRole("SYSTEM_ADMIN", "OWNER"), async (req, res) => {
  const parsed = z.object({ label: z.enum(AUDIT_LABELS) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  res.json(await applyLabel(req.session!, parsed.data.label));
});

auditRouter.get("/obligations", async (req, res) => {
  res.json(await obligations(req.session!.storeId));
});
