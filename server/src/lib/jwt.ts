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

export function signSession(claims: SessionClaims): string {
  return jwt.sign(claims, JWT_SECRET, { expiresIn: TOKEN_TTL });
}

export function verifySession(token: string): SessionClaims {
  return jwt.verify(token, JWT_SECRET) as SessionClaims;
}
