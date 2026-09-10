import type { NextFunction, Request, Response } from "express";
import type { Role } from "../lib/enums";

// Compares the endpoint's required roles ONLY against req.session.activeRole.
// This is the anti-cross-role-leakage rule from security_guideline_document.md and
// backend_structure_document.md spelled out in code: a Manager who is signed in as
// Consignor for this session must get 403 here, exactly like a stranger would.
export function requireRole(...allowed: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.session) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    if (!allowed.includes(req.session.activeRole)) {
      return res.status(403).json({
        error: `Active role ${req.session.activeRole} may not perform this action`,
      });
    }
    next();
  };
}
