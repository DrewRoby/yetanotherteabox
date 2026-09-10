import { Navigate } from "react-router-dom";
import { useAuth } from "./AuthContext";
import type { Role } from "./roles";

// Client-side gate matching NAV_ENTRIES — purely a UX convenience (hide/redirect).
// The server's requireRole middleware is the actual security boundary; this never
// substitutes for it.
export function RequireRole({ roles, children }: { roles: Role[]; children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  if (!roles.includes(user.activeRole)) return <Navigate to="/access-denied" replace />;
  return <>{children}</>;
}
