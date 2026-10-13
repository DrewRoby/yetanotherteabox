import { prisma } from "../lib/prisma";
import type { SessionClaims } from "../lib/jwt";
import { recordAudit, recordAuditMany } from "../lib/audit";
import { AUDIT_LABELS, type AuditLabel } from "../lib/enums";

// Inventory Audit (/audit): an explorer over the store's *active* items (AVAILABLE or
// PENDING) for working out what's really on the floor, who it belongs to and what it's
// worth. Every item gets a set of derived dimensions (below); the page filters on any
// of them, pivots by one, and labels the matching items. Labels are reviewable
// decisions; applying one (applyLabel) changes status/ownership, audited.
//
// The active set is ~20k rows, so everything is one SQL pass over Item ⋈ Account with
// the dimensions computed as CASE expressions — no denormalized columns needed.

// Consignment period: a consigned item unsold this long is "expired" (Hidden Treasures:
// 90 days, then the store's — confirmed with the user 2026-10-12).
export const CONSIGNMENT_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

// Effective consignor share: the item's own split (migrated Liberty items), else the
// account's, else 100 — the same rule as checkout (consignorShareOf). Store-owned
// accounts (STORE type / isStoreAccount) are owed nothing whatever the split says.
const STORE_OWNED = `(a."accountType" NOT IN ('CONSIGNOR','VENDOR','BOOTH_OWNER') OR a."isStoreAccount" = 1)`;
const PCT = `(CASE WHEN ${STORE_OWNED} THEN 0 ELSE COALESCE(i."consignorPercent", a."splitPercent", 100) END)`;

// now = epoch ms, bound as ?1 in every query.
export const DIMENSIONS = {
  age: {
    label: "Age",
    sql: `CASE WHEN i."intakeDate" >= ?1 - ${CONSIGNMENT_DAYS * DAY_MS} THEN 'current'
               WHEN i."intakeDate" >= ?1 - ${365 * DAY_MS} THEN '90d-1y'
               WHEN i."intakeDate" >= ?1 - ${3 * 365 * DAY_MS} THEN '1-3y' ELSE '3y+' END`,
    order: ["current", "90d-1y", "1-3y", "3y+"],
  },
  owner: {
    label: "Owner",
    sql: `CASE WHEN a."accountType" = 'STORE' THEN 'store'
               WHEN a."isStoreAccount" = 1 THEN 'store-account'
               WHEN ${PCT} = 0 THEN 'consigned-0'
               ELSE 'consigned' END`,
    order: ["consigned", "consigned-0", "store-account", "store"],
  },
  expired: {
    label: "Consignment",
    sql: `CASE WHEN ${STORE_OWNED} OR ${PCT} = 0 THEN 'n/a'
               WHEN i."intakeDate" >= ?1 - ${CONSIGNMENT_DAYS * DAY_MS} THEN 'in-period' ELSE 'expired' END`,
    order: ["expired", "in-period", "n/a"],
  },
  accountStatus: {
    label: "Account",
    sql: `CASE WHEN a."isActive" = 1 THEN 'active' ELSE 'inactive' END`,
    order: ["active", "inactive"],
  },
  ownerLastSale: {
    label: "Owner's last sale",
    sql: `CASE WHEN a."lastSaleAt" IS NULL THEN 'never'
               WHEN a."lastSaleAt" >= ?1 - ${365 * DAY_MS} THEN '<1y'
               WHEN a."lastSaleAt" >= ?1 - ${3 * 365 * DAY_MS} THEN '1-3y' ELSE '3y+' END`,
    order: ["<1y", "1-3y", "3y+", "never"],
  },
  tagged: {
    label: "Tag printed",
    sql: `CASE WHEN i."tagPrintedAt" IS NULL THEN 'never' ELSE 'yes' END`,
    order: ["yes", "never"],
  },
  donate: {
    label: "Donate if unsold",
    sql: `CASE WHEN i."donateIfUnsold" IS NULL THEN 'unknown' WHEN i."donateIfUnsold" = 1 THEN 'yes' ELSE 'no' END`,
    order: ["yes", "no", "unknown"],
  },
  split: {
    label: "Consignor split",
    sql: `CAST(${PCT} AS TEXT) || '%'`,
    order: null,
  },
  category: { label: "Category", sql: `i."category"`, order: null },
  price: {
    label: "Price",
    sql: `CASE WHEN i."price" < 5 THEN '<$5' WHEN i."price" < 20 THEN '$5-20' WHEN i."price" < 50 THEN '$20-50' ELSE '$50+' END`,
    order: ["<$5", "$5-20", "$20-50", "$50+"],
  },
  status: { label: "Status", sql: `i."status"`, order: ["AVAILABLE", "PENDING"] },
  label: {
    label: "Audit label",
    sql: `CASE WHEN i."auditLabel" IS NULL THEN 'unlabeled'
               WHEN i."auditAppliedAt" IS NOT NULL THEN i."auditLabel" || ':applied' ELSE i."auditLabel" END`,
    order: null,
  },
} as const;
export type Dimension = keyof typeof DIMENSIONS;
export const DIMENSION_KEYS = Object.keys(DIMENSIONS) as Dimension[];

export type Filters = Partial<Record<Dimension, string[]>> & { q?: string; accountId?: string };

const ACTIVE = `i."status" IN ('AVAILABLE','PENDING')`;
const FROM = `FROM "Item" i JOIN "Account" a ON a."id" = i."accountId"`;

// WHERE clause + params for the store, the active set and the filters. Params start at
// ?2 (?1 is `now`).
function where(storeId: string, filters: Filters) {
  const params: unknown[] = [Date.now(), storeId];
  const clauses = [`i."storeId" = ?2`, ACTIVE];
  for (const key of DIMENSION_KEYS) {
    const values = filters[key];
    if (!values?.length) continue;
    const marks = values.map((v) => {
      params.push(v);
      return `?${params.length}`;
    });
    clauses.push(`(${DIMENSIONS[key].sql}) IN (${marks.join(",")})`);
  }
  if (filters.q) {
    params.push(filters.q.toLowerCase());
    const n = params.length;
    clauses.push(`(instr(lower(i."description"), ?${n}) > 0 OR instr(lower(i."sku"), ?${n}) > 0 OR instr(lower(a."name"), ?${n}) > 0)`);
  }
  if (filters.accountId) {
    params.push(filters.accountId);
    clauses.push(`i."accountId" = ?${params.length}`);
  }
  return { sql: `WHERE ${clauses.join(" AND ")}`, params };
}

const MEASURES = `COUNT(*) AS "count", COALESCE(SUM(i."price"), 0) AS "retail",
  COALESCE(SUM(i."price" * ${PCT} / 100.0), 0) AS "consignorShare"`;

// SQLite hands back integer aggregates as BigInt (e.g. COALESCE(SUM(..), 0) over no
// rows), which JSON can't serialize — always go through Number().
interface MeasureRow {
  count: bigint | number;
  retail: bigint | number;
  consignorShare: bigint | number;
}
const measures = (r: MeasureRow) => ({
  count: Number(r.count),
  retail: Number(r.retail),
  consignorShare: Number(r.consignorShare),
  storeShare: Number(r.retail) - Number(r.consignorShare),
});

// Faceted: the pivot ignores the grouped dimension's own filter, so every value of it
// stays listed (and selectable) while the others narrow it; totals apply all filters.
export async function auditSummary(storeId: string, filters: Filters, groupBy: Dimension) {
  const w = where(storeId, filters);
  const g = where(storeId, { ...filters, [groupBy]: undefined });
  const [totalRows, groupRows, labelRows] = await Promise.all([
    prisma.$queryRawUnsafe<MeasureRow[]>(`SELECT ${MEASURES} ${FROM} ${w.sql}`, ...w.params),
    prisma.$queryRawUnsafe<(MeasureRow & { key: string | null })[]>(
      `SELECT (${DIMENSIONS[groupBy].sql}) AS "key", ${MEASURES} ${FROM} ${g.sql} GROUP BY 1`,
      ...g.params
    ),
    // Label progress is always over the whole active set, not the current filters.
    prisma.$queryRawUnsafe<(MeasureRow & { key: string })[]>(
      `SELECT (${DIMENSIONS.label.sql}) AS "key", ${MEASURES} ${FROM} WHERE i."storeId" = ?2 AND ${ACTIVE} GROUP BY 1`,
      Date.now(),
      storeId
    ),
  ]);
  const order: readonly string[] | null = DIMENSIONS[groupBy].order;
  const groups = groupRows
    .map((g) => ({ key: g.key ?? "—", ...measures(g) }))
    .sort((a, b) => (order ? order.indexOf(a.key) - order.indexOf(b.key) : b.count - a.count));
  return {
    groupBy,
    totals: measures(totalRows[0]),
    groups,
    labels: labelRows.map((l) => ({ key: l.key, ...measures(l) })),
  };
}

const SORTS = {
  intake: `i."intakeDate"`,
  price: `i."price"`,
  sku: `i."itemNumber"`,
  account: `a."name"`,
  category: `i."category"`,
} as const;
export type AuditSort = keyof typeof SORTS;

export async function auditItems(
  storeId: string,
  filters: Filters,
  opts: { sort: AuditSort; dir: "asc" | "desc"; page: number; pageSize: number }
) {
  const w = where(storeId, filters);
  const [rows, [total]] = await Promise.all([
    prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT i."id", i."sku", i."description", i."category", i."price", i."status", i."intakeDate",
              i."tagPrintedAt", i."donateIfUnsold", i."auditLabel", i."auditAppliedAt",
              ${PCT} AS "consignorPercent", a."id" AS "accountId", a."name" AS "accountName",
              a."isActive" AS "accountActive", (${DIMENSIONS.owner.sql}) AS "owner"
       ${FROM} ${w.sql}
       ORDER BY ${SORTS[opts.sort]} ${opts.dir === "asc" ? "ASC" : "DESC"}, i."itemNumber"
       LIMIT ${opts.pageSize} OFFSET ${(opts.page - 1) * opts.pageSize}`,
      ...w.params
    ),
    prisma.$queryRawUnsafe<{ n: bigint | number }[]>(`SELECT COUNT(*) AS "n" ${FROM} ${w.sql}`, ...w.params),
  ]);
  return {
    rows: rows.map((r) => ({
      ...r,
      price: Number(r.price),
      consignorPercent: Number(r.consignorPercent),
      intakeDate: new Date(Number(r.intakeDate)),
      tagPrintedAt: r.tagPrintedAt == null ? null : new Date(Number(r.tagPrintedAt)),
      auditAppliedAt: r.auditAppliedAt == null ? null : new Date(Number(r.auditAppliedAt)),
      donateIfUnsold: r.donateIfUnsold == null ? null : Number(r.donateIfUnsold) === 1,
      accountActive: Number(r.accountActive) === 1,
    })),
    total: Number(total.n),
    page: opts.page,
    pageSize: opts.pageSize,
  };
}

// Sets (or clears, label = null) the audit label on the chosen items — explicit ids, or
// everything matching `filters`. Only unapplied labels change: an applied decision has
// already moved the item, so relabeling it would misreport what happened.
export async function setLabel(
  session: SessionClaims,
  target: { itemIds: string[] } | { filters: Filters },
  label: AuditLabel | null
) {
  let ids: string[];
  if ("itemIds" in target) {
    ids = target.itemIds;
  } else {
    const w = where(session.storeId, target.filters);
    ids = (await prisma.$queryRawUnsafe<{ id: string }[]>(`SELECT i."id" ${FROM} ${w.sql}`, ...w.params)).map((r) => r.id);
  }
  let changed = 0;
  for (let i = 0; i < ids.length; i += 900) {
    const res = await prisma.item.updateMany({
      where: {
        id: { in: ids.slice(i, i + 900) },
        storeId: session.storeId,
        status: { in: ["AVAILABLE", "PENDING"] },
        auditAppliedAt: null,
      },
      data: label
        ? { auditLabel: label, auditLabeledAt: new Date(), auditLabeledById: session.sub }
        : { auditLabel: null, auditLabeledAt: null, auditLabeledById: null },
    });
    changed += res.count;
  }
  // One summary entry, not one per item: a label is a reversible working note until applied.
  await recordAudit(session, "InventoryAudit", session.storeId, label ? "AUDIT_LABEL" : "AUDIT_UNLABEL", {
    label,
    count: changed,
    ...("filters" in target ? { filters: target.filters } : { itemIds: ids.length }),
  });
  return { changed, skipped: ids.length - changed };
}

const APPLY_STATUS: Partial<Record<AuditLabel, string>> = { DONATE: "DONATED", RETURN: "RETURNED", WRITE_OFF: "DISPOSED" };

// Applies every pending (unapplied) item carrying `label`. KEEP has nothing to apply.
// EXPIRED_TO_STORE moves the item to the store's built-in STORE account (it stays on
// the floor; a later sale credits nobody). The others set the matching status. Each item
// gets an ItemHistory entry and a per-item audit entry, like any other edit.
export async function applyLabel(session: SessionClaims, label: AuditLabel) {
  if (!AUDIT_LABELS.includes(label) || label === "KEEP") return { applied: 0 };
  const items = await prisma.item.findMany({
    where: {
      storeId: session.storeId,
      auditLabel: label,
      auditAppliedAt: null,
      status: { in: ["AVAILABLE", "PENDING"] },
    },
    select: { id: true, status: true, accountId: true, account: { select: { name: true } } },
  });
  if (items.length === 0) return { applied: 0 };
  const storeAccount =
    label === "EXPIRED_TO_STORE"
      ? await prisma.account.findFirstOrThrow({ where: { storeId: session.storeId, accountType: "STORE" } })
      : null;
  const now = new Date();
  for (let i = 0; i < items.length; i += 500) {
    const batch = items.slice(i, i + 500);
    const ids = batch.map((b) => b.id);
    await prisma.$transaction([
      prisma.item.updateMany({
        where: { id: { in: ids } },
        data: storeAccount
          ? { accountId: storeAccount.id, auditAppliedAt: now }
          : { status: APPLY_STATUS[label]!, auditAppliedAt: now },
      }),
      prisma.itemHistory.createMany({
        data: batch.map((b) =>
          storeAccount
            ? {
                itemId: b.id,
                changeType: "EDIT",
                oldValue: `account: ${b.account.name}`,
                newValue: `account: ${storeAccount.name} (expired consignment — Inventory Audit)`,
                changedById: session.sub,
                activeRole: session.activeRole,
                timestamp: now,
              }
            : {
                itemId: b.id,
                changeType: "STATUS_CHANGE",
                oldValue: b.status,
                newValue: `${APPLY_STATUS[label]} (Inventory Audit: ${label})`,
                changedById: session.sub,
                activeRole: session.activeRole,
                timestamp: now,
              }
        ),
      }),
    ]);
    await recordAuditMany(
      session,
      "Item",
      batch.map((b) => ({
        entityId: b.id,
        action: storeAccount ? "AUDIT_TO_STORE" : "AUDIT_STATUS",
        details: storeAccount
          ? { label, fromAccountId: b.accountId, toAccountId: storeAccount.id }
          : { label, from: b.status, to: APPLY_STATUS[label] },
      }))
    );
  }
  return { applied: items.length };
}

// Outstanding payout obligations, aged by each account's last activity (latest intake,
// sale or payout — same definition as the Accounts list), plus the biggest balances.
// Store-owned accounts carry no balance by rule and are excluded.
export async function obligations(storeId: string) {
  const raw = await prisma.$queryRawUnsafe<
    { id: string; name: string; isActive: bigint | number; balance: bigint | number; lastActivity: bigint | number | null }[]
  >(
    `SELECT a."id", a."name", a."isActive", a."currentBalance" AS "balance",
            MAX(COALESCE(a."lastSaleAt", 0),
                COALESCE((SELECT MAX(p."createdAt") FROM "Payout" p WHERE p."accountId" = a."id"), 0),
                COALESCE((SELECT MAX(i."intakeDate") FROM "Item" i WHERE i."accountId" = a."id"), 0)) AS "lastActivity"
     FROM "Account" a
     WHERE a."storeId" = ?1 AND a."accountType" IN ('CONSIGNOR','VENDOR','BOOTH_OWNER') AND a."isStoreAccount" = 0
       AND a."currentBalance" <> 0`,
    storeId
  );
  const rows = raw.map((r) => ({ ...r, balance: Number(r.balance) }));
  const now = Date.now();
  const bucket = (t: number) =>
    !t ? "never" : t >= now - 365 * DAY_MS ? "<1y" : t >= now - 3 * 365 * DAY_MS ? "1-3y" : t >= now - 10 * 365 * DAY_MS ? "3-10y" : "10y+";
  const order = ["<1y", "1-3y", "3-10y", "10y+", "never"];
  const aging = new Map(order.map((k) => [k, { key: k, accounts: 0, owed: 0, activeOwed: 0 }]));
  let owed = 0;
  let activeOwed = 0;
  let owedAccounts = 0;
  let negative = 0;
  let negativeAccounts = 0;
  for (const r of rows) {
    if (r.balance < 0) {
      negative += r.balance;
      negativeAccounts++;
      continue;
    }
    owed += r.balance;
    owedAccounts++;
    const active = Number(r.isActive) === 1;
    if (active) activeOwed += r.balance;
    const b = aging.get(bucket(Number(r.lastActivity ?? 0)))!;
    b.accounts++;
    b.owed += r.balance;
    if (active) b.activeOwed += r.balance;
  }
  const top = rows
    .filter((r) => r.balance > 0)
    .sort((a, b) => b.balance - a.balance)
    .slice(0, 50)
    .map((r) => ({
      id: r.id,
      name: r.name,
      isActive: Number(r.isActive) === 1,
      balance: r.balance,
      lastActivity: r.lastActivity ? new Date(Number(r.lastActivity)) : null,
    }));
  const negatives = rows
    .filter((r) => r.balance < 0)
    .sort((a, b) => a.balance - b.balance)
    .map((r) => ({ id: r.id, name: r.name, isActive: Number(r.isActive) === 1, balance: r.balance }));

  // Inventory value of the whole active floor, split by who it belongs to.
  const w = where(storeId, {});
  const inv = await prisma.$queryRawUnsafe<(MeasureRow & { key: string })[]>(
    `SELECT (${DIMENSIONS.owner.sql}) AS "key", ${MEASURES} ${FROM} ${w.sql} GROUP BY 1`,
    ...w.params
  );
  return {
    owed,
    activeOwed,
    owedAccounts,
    negative,
    negativeAccounts,
    aging: [...aging.values()],
    top,
    negatives,
    inventory: inv.map((r) => ({ key: r.key, ...measures(r) })),
  };
}
