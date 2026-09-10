import type { NextFunction, Request, Response } from "express";
import { verifySession, type SessionClaims } from "../lib/jwt";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      session?: SessionClaims;
    }
  }
}

// Decodes the bearer token into req.session. This is the ONLY place a request's
// identity is established, and it carries exactly one active role — never the
// union of every role the underlying user holds. Downstream code (requireRole,
// services) must read req.session.activeRole and nothing else when deciding what a
// request is allowed to do.
export function authenticate(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing bearer token" });
  }
  try {
    req.session = verifySession(header.slice("Bearer ".length));
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired session" });
  }
}
