import { prisma } from "./prisma";
import type { SessionClaims } from "./jwt";

// Records an action alongside the ACTIVE ROLE the session was using, not just the
// user — an audit entry must be interpretable strictly in the context of the role
// that performed it (security_guideline_document.md, "audit logs capture active role").
export async function recordAudit(
  session: SessionClaims,
  entity: string,
  entityId: string,
  action: string,
  details?: Record<string, unknown>
) {
  await prisma.auditLog.create({
    data: {
      entity,
      entityId,
      action,
      performedById: session.sub,
      activeRole: session.activeRole,
      details: details ? JSON.stringify(details) : undefined,
    },
  });
}
