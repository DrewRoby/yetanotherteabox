import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma";
import { signSession, type SessionClaims } from "../lib/jwt";
import type { Role } from "../lib/enums";

export interface RoleOption {
  role: Role;
  storeId: string;
  storeName: string;
  accountId: string | null;
}

async function loadRoleOptions(userId: string): Promise<RoleOption[]> {
  const roles = await prisma.userRole.findMany({
    where: { userId },
    include: { store: true },
  });
  return roles.map((r) => ({
    role: r.role as Role,
    storeId: r.storeId,
    storeName: r.store.name,
    accountId: r.accountId,
  }));
}

export async function verifyCredentials(email: string, password: string) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return null;
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return null;
  return user;
}

// Returns either a single ready-to-use token (user has exactly one role) or the list
// of roles the user must choose between. Never guesses; the wireframe's login role
// picker exists precisely to make this an explicit, user-driven choice.
export async function beginSession(userId: string) {
  const roleOptions = await loadRoleOptions(userId);
  if (roleOptions.length === 0) {
    throw new Error("User has no assigned roles");
  }
  if (roleOptions.length === 1) {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const token = issueToken(user, roleOptions[0]);
    return { needsRoleSelection: false as const, token, activeRole: roleOptions[0].role };
  }
  return { needsRoleSelection: true as const, roles: roleOptions };
}

export async function selectRole(userId: string, role: Role, storeId: string) {
  const roleOptions = await loadRoleOptions(userId);
  const match = roleOptions.find((r) => r.role === role && r.storeId === storeId);
  if (!match) {
    throw new Error("User does not hold the requested role at that store");
  }
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  return issueToken(user, match);
}

function issueToken(user: { id: string; email: string; name: string }, roleOption: RoleOption) {
  const claims: SessionClaims = {
    sub: user.id,
    activeRole: roleOption.role,
    storeId: roleOption.storeId,
    accountId: roleOption.accountId ?? undefined,
    name: user.name,
    email: user.email,
  };
  return signSession(claims);
}

export { loadRoleOptions };
