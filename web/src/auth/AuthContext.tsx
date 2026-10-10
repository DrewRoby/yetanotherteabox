import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, clearToken, getToken, setToken } from "../api/client";
import type { Role } from "./roles";

export interface RoleOption {
  role: Role;
  storeId: string;
  storeName: string;
  accountId: string | null;
}

export interface CurrentUser {
  userId: string;
  name: string;
  email: string;
  activeRole: Role;
  storeId: string;
  storeName: string;
  accountId: string | null;
  availableRoles: RoleOption[];
}

interface AuthContextValue {
  user: CurrentUser | null;
  loading: boolean;
  // Whether this deployment has never had its first-run Setup Wizard completed (no
  // Store exists yet). Only meaningful when `user` is null — an existing session
  // always implies setup already happened. See SetupWizardPage / App.tsx's routing.
  needsSetup: boolean;
  // With more than one role, returns the choices plus a short-lived ticket (server
  // side: lib/jwt.ts) that selectRole must present — there's no userId to pass.
  login: (email: string, password: string) => Promise<{ needsRoleSelection: boolean; ticket?: string; roles?: RoleOption[] }>;
  selectRole: (ticket: string, role: Role, storeId: string) => Promise<void>;
  // Sign-in-sheet badge scan. With more than one badge-eligible role, the first call
  // returns the choices; call again with the same code plus the picked role.
  badgeLogin: (code: string, role?: RoleOption) => Promise<{ needsRoleSelection: boolean; roles?: RoleOption[] }>;
  switchRole: (role: Role, storeId: string) => Promise<void>;
  logout: () => void;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [loading, setLoading] = useState(true);

  const refreshMe = useCallback(async () => {
    if (!getToken()) {
      setUser(null);
      return;
    }
    try {
      const me = await api.get<CurrentUser>("/auth/me");
      setUser(me);
    } catch {
      clearToken();
      setUser(null);
    }
  }, []);

  useEffect(() => {
    (async () => {
      // Setup status is checked unconditionally (it's what decides whether an
      // unauthenticated visitor sees the Setup Wizard or the Login page), alongside
      // the existing session check.
      await Promise.all([
        refreshMe(),
        api
          .get<{ needsSetup: boolean }>("/setup/status")
          .then((r) => setNeedsSetup(r.needsSetup))
          .catch(() => setNeedsSetup(false)),
      ]);
      setLoading(false);
    })();
  }, [refreshMe]);

  const login = useCallback(async (email: string, password: string) => {
    const result = await api.post<{ needsRoleSelection: boolean; token?: string; ticket?: string; roles?: RoleOption[] }>(
      "/auth/login",
      { email, password }
    );
    if (!result.needsRoleSelection && result.token) {
      setToken(result.token);
      await refreshMe();
      return { needsRoleSelection: false };
    }
    return { needsRoleSelection: true, ticket: result.ticket, roles: result.roles };
  }, [refreshMe]);

  const selectRole = useCallback(async (ticket: string, role: Role, storeId: string) => {
    const result = await api.post<{ token: string }>("/auth/select-role", { ticket, role, storeId });
    setToken(result.token);
    await refreshMe();
  }, [refreshMe]);

  const badgeLogin = useCallback(async (code: string, role?: RoleOption) => {
    const result = await api.post<{ needsRoleSelection: boolean; token?: string; roles?: RoleOption[] }>(
      "/auth/badge-login",
      { code, role: role?.role, storeId: role?.storeId }
    );
    if (!result.needsRoleSelection && result.token) {
      setToken(result.token);
      await refreshMe();
      return { needsRoleSelection: false };
    }
    return { needsRoleSelection: true, roles: result.roles };
  }, [refreshMe]);

  const switchRole = useCallback(async (role: Role, storeId: string) => {
    const result = await api.post<{ token: string }>("/auth/switch-role", { role, storeId });
    setToken(result.token);
    await refreshMe();
  }, [refreshMe]);

  const logout = useCallback(() => {
    clearToken();
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, loading, needsSetup, login, selectRole, badgeLogin, switchRole, logout, refresh: refreshMe }),
    [user, loading, needsSetup, login, selectRole, badgeLogin, switchRole, logout, refreshMe]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
