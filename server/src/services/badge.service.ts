import crypto from "crypto";
import { prisma } from "../lib/prisma";
import type { Role } from "../lib/enums";
import { loadRoleOptions, type RoleOption } from "./auth.service";

// Sign-in-sheet badges: a printed barcode/QR per employee that logs them in with one
// scan (Reports > Employee Sign-In Sheet on the web side, POST /auth/badge-login here).
//
// A badge is a bearer credential printed on paper, so it's deliberately weaker in
// scope than a password:
// - Only floor roles can be entered via badge. OWNER/SYSTEM_ADMIN (user management,
//   invites) and account-scoped roles (a consignor's balance/payouts) always need a
//   password, even for a person who also holds a badge-eligible role. Because
//   MANAGER is the ceiling here, any session allowed to issue badges (Manager and
//   up) already outranks every role a badge can unlock — if OWNER is ever added to
//   this list, issuing needs a "may not issue above your own rank" check too.
// - Only a SHA-256 of the code is stored (no bcrypt needed: the code is 100 random
//   bits, not a human-chosen secret). The plaintext is returned once, at issue time,
//   for the sheet to render — so reprinting a sheet always rotates codes, and a lost
//   sheet is dealt with by reprinting (or revoking).
export const BADGE_ROLES: Role[] = ["MANAGER", "EMPLOYEE", "REGISTER"];

// Distinct from item SKUs (`${storeId}-000123`, see lib/barcode.ts) so a badge
// scanned into the POS input, or a tag scanned into the login badge field, can't be
// mistaken for the other.
const BADGE_PREFIX = "TBXB-";
// Crockford-style base32: uppercase + digits, minus I/L/O/U. Uppercase-only matters
// for HID scanners, which "type" the code and can be thrown off by Caps Lock on
// mixed-case values.
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const CODE_LENGTH = 20; // 20 × 5 bits = 100 bits of entropy

function generateBadgeCode(): string {
  const bytes = crypto.randomBytes(CODE_LENGTH);
  let out = "";
  for (const b of bytes) out += ALPHABET[b & 31]; // 256 is a multiple of 32: no modulo bias
  return BADGE_PREFIX + out;
}

export function hashBadgeCode(code: string): string {
  return crypto.createHash("sha256").update(code.trim().toUpperCase()).digest("hex");
}

function badgeRoleOptions(options: RoleOption[]) {
  return options.filter((o) => BADGE_ROLES.includes(o.role));
}

// Staff at this store who hold at least one badge-eligible role — the rows of the
// sign-in sheet. `roles` lists only the badge-eligible ones.
export async function listBadgeEligibleUsers(storeId: string) {
  const grants = await prisma.userRole.findMany({
    where: { storeId, role: { in: BADGE_ROLES } },
    include: { user: { select: { id: true, name: true, email: true, badgeIssuedAt: true } } },
    orderBy: { user: { name: "asc" } },
  });
  const byUser = new Map<string, { userId: string; name: string; email: string; roles: Role[]; badgeIssuedAt: Date | null }>();
  for (const g of grants) {
    const row = byUser.get(g.userId) ?? {
      userId: g.user.id,
      name: g.user.name,
      email: g.user.email,
      roles: [],
      badgeIssuedAt: g.user.badgeIssuedAt,
    };
    row.roles.push(g.role as Role);
    byUser.set(g.userId, row);
  }
  return Array.from(byUser.values());
}

// Issues (or rotates) badges for the given users. Users not badge-eligible at this
// store are skipped rather than erroring, so a stale client selection can't be used
// to mint a badge for, say, a consignor or someone at another store.
export async function issueBadges(storeId: string, userIds: string[]) {
  const eligible = (await listBadgeEligibleUsers(storeId)).filter((u) => userIds.includes(u.userId));
  const issued: { userId: string; name: string; roles: Role[]; code: string; badgeIssuedAt: Date }[] = [];
  for (const u of eligible) {
    const code = generateBadgeCode();
    const badgeIssuedAt = new Date();
    await prisma.user.update({
      where: { id: u.userId },
      data: { badgeCodeHash: hashBadgeCode(code), badgeIssuedAt },
    });
    issued.push({ userId: u.userId, name: u.name, roles: u.roles, code, badgeIssuedAt });
  }
  return issued;
}

// Only users with a badge-eligible role at this store can be revoked from here —
// same scoping as issuing.
export async function revokeBadge(storeId: string, userId: string) {
  const eligible = await listBadgeEligibleUsers(storeId);
  if (!eligible.some((u) => u.userId === userId)) return false;
  await prisma.user.update({ where: { id: userId }, data: { badgeCodeHash: null, badgeIssuedAt: null } });
  return true;
}

// Resolves a scanned code to its user plus the roles a badge session may take.
// Returns null for unknown codes AND for users left with no badge-eligible role (e.g.
// demoted since the sheet was printed) — the caller answers both identically.
export async function resolveBadge(code: string) {
  const user = await prisma.user.findUnique({ where: { badgeCodeHash: hashBadgeCode(code) } });
  if (!user) return null;
  const roles = badgeRoleOptions(await loadRoleOptions(user.id));
  if (roles.length === 0) return null;
  return { user, roles };
}
