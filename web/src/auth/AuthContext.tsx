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
  login: (email: string, password: string) => Promise<{ needsRoleSelection: boolean; userId?: string; roles?: RoleOption[] }>;
  selectRole: (userId: string, role: Role, storeId: string) => Promise<void>;
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
    const result = await api.post<{ needsRoleSelection: boolean; token?: string; userId?: string; roles?: RoleOption[] }>(
      "/auth/login",
      { email, password }
    );
    if (!result.needsRoleSelection && result.token) {
      setToken(result.token);
      await refreshMe();
      return { needsRoleSelection: false };
    }
    return { needsRoleSelection: true, userId: result.userId, roles: result.roles };
  }, [refreshMe]);

  const selectRole = useCallback(async (userId: string, role: Role, storeId: string) => {
    const result = await api.post<{ token: string }>("/auth/select-role", { userId, role, storeId });
    setToken(result.token);
    await refreshMe();
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
    () => ({ user, loading, needsSetup, login, selectRole, switchRole, logout, refresh: refreshMe }),
    [user, loading, needsSetup, login, selectRole, switchRole, logout, refreshMe]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
