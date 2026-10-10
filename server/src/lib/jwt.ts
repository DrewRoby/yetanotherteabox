import jwt from "jsonwebtoken";
import type { Role } from "./enums";

const JWT_SECRET = process.env.JWT_SECRET || "teabox-dev-secret-change-me";
const TOKEN_TTL = "8h"; // matches the 8hr absolute session timeout in security_guideline_document.md

// Everything the rest of the app is allowed to know about "who is asking" for the
// duration of a session. Deliberately does NOT include the user's other roles —
// authorization must never see them (see requireRole.ts).
export interface SessionClaims {
  sub: string; // User.id
  activeRole: Role;
  storeId: string;
  accountId?: string; // set when activeRole is account-scoped (Consignor/Vendor/Donor/BoothOwner)
  name: string;
  email: string;
}

// Every token this file signs carries a `typ` claim, and each verifier accepts only
// its own — so a role-selection ticket (same secret, different purpose) can never be
// presented as a session, and vice versa.
const SESSION_TYP = "session";
const ROLE_SELECTION_TYP = "role-selection";
const ROLE_SELECTION_TTL = "5m";

export function signSession(claims: SessionClaims): string {
  return jwt.sign({ ...claims, typ: SESSION_TYP }, JWT_SECRET, { expiresIn: TOKEN_TTL });
}

export function verifySession(token: string): SessionClaims {
  const payload = jwt.verify(token, JWT_SECRET) as SessionClaims & { typ?: string };
  if (payload.typ !== SESSION_TYP) throw new Error("Not a session token");
  return payload;
}

// Short-lived proof that the holder just passed /login's password check, handed out
// only when the user must pick among several roles. /select-role takes the userId
// from this ticket, never from the request body — a bare userId (which leaks through
// /me, /settings/users, etc.) is not a credential.
export function signRoleSelectionTicket(userId: string): string {
  return jwt.sign({ sub: userId, typ: ROLE_SELECTION_TYP }, JWT_SECRET, { expiresIn: ROLE_SELECTION_TTL });
}

export function verifyRoleSelectionTicket(ticket: string): string {
  const payload = jwt.verify(ticket, JWT_SECRET) as { sub?: string; typ?: string };
  if (payload.typ !== ROLE_SELECTION_TYP || !payload.sub) throw new Error("Not a role-selection ticket");
  return payload.sub;
}
