import { useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { NAV_ENTRIES, ROLE_LABELS } from "../auth/roles";

export function AppShell({ children }: { children: ReactNode }) {
  const { user, logout, switchRole } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [switching, setSwitching] = useState(false);

  if (!user) return null;

  const visibleNav = NAV_ENTRIES.filter((entry) => entry.roles.includes(user.activeRole));
  const otherRoles = user.availableRoles.filter(
    (r) => !(r.role === user.activeRole && r.storeId === user.storeId)
  );

  return (
    <div className="flex h-screen overflow-hidden bg-bone">
      <aside className="w-60 bg-ink text-white flex flex-col border-r-4 border-gold shrink-0">
        <div className="px-5 py-6 border-b border-white/10 flex items-center gap-3">
          <div className="w-9 h-9 bg-crimson flex items-center justify-center font-bold text-lg border border-gold">茶</div>
          <span className="font-bold tracking-wider uppercase text-gold text-sm">Teabox ERP</span>
        </div>
        <nav className="flex-1 py-2">
          {visibleNav.map((entry) => {
            const active = location.pathname.startsWith(entry.path);
            return (
              <Link
                key={entry.path}
                to={entry.path}
                className={`block px-6 py-3 text-sm border-l-4 transition-colors ${
                  active ? "bg-[#222] text-white border-crimson" : "text-gray-300 border-transparent hover:bg-[#222] hover:text-white"
                }`}
              >
                {entry.label}
              </Link>
            );
          })}
        </nav>
        <div className="px-5 py-4 text-[11px] text-gray-400 border-t border-white/10">
          {user.storeName}
        </div>
      </aside>

      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="h-[70px] bg-bone border-b-2 border-ink flex items-center justify-between px-8 shrink-0">
          <div className="text-xl font-black uppercase tracking-wide">{titleFor(location.pathname)}</div>
          <div className="flex items-center gap-4">
            <span className="border border-gold bg-white px-3 py-1 text-xs font-bold uppercase">
              {ROLE_LABELS[user.activeRole]}
            </span>
            <div className="relative">
              <button
                className="text-sm font-semibold underline decoration-gold decoration-2 underline-offset-4"
                onClick={() => setSwitching((s) => !s)}
              >
                {user.name}
              </button>
              {switching && (
                <div className="absolute right-0 mt-2 w-56 bg-white border border-ink shadow-lg z-10 text-sm">
                  {otherRoles.length > 0 && (
                    <div className="border-b border-gray-200">
                      <div className="px-3 py-2 text-[10px] uppercase tracking-wide text-gray-500">Switch Role</div>
                      {otherRoles.map((r) => (
                        <button
                          key={`${r.role}-${r.storeId}`}
                          className="w-full text-left px-3 py-2 hover:bg-bone"
                          onClick={async () => {
                            await switchRole(r.role, r.storeId);
                            setSwitching(false);
                            // The active route may not be valid for the new role (e.g.
                            // Manager -> Consignor while on /inventory) — send the user
                            // to their role's home rather than leaving them on a route
                            // that's about to redirect to Access Denied.
                            navigate("/");
                          }}
                        >
                          {ROLE_LABELS[r.role]}
                        </button>
                      ))}
                    </div>
                  )}
                  <button className="w-full text-left px-3 py-2 hover:bg-bone text-crimson font-semibold" onClick={logout}>
                    Sign Out
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}

function titleFor(pathname: string): string {
  const entry = NAV_ENTRIES.find((e) => pathname.startsWith(e.path));
  return entry?.label ?? "Teabox";
}
