import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "./auth/AuthContext";
import { RequireRole } from "./auth/RequireRole";
import { AppShell } from "./layout/AppShell";
import { LoginPage } from "./pages/LoginPage";
import { SetupWizardPage } from "./pages/SetupWizardPage";
import { DashboardPage } from "./pages/DashboardPage";
import { InventoryPage } from "./pages/InventoryPage";
import { ItemDetailPage } from "./pages/ItemDetailPage";
import { IntakePage } from "./pages/IntakePage";
import { PosPage } from "./pages/PosPage";
import { AccountsPage } from "./pages/AccountsPage";
import { ConsignorPortalPage } from "./pages/ConsignorPortalPage";
import { BoothOwnerPricingPage } from "./pages/BoothOwnerPricingPage";
import { ReportsPage } from "./pages/ReportsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { AccessDeniedPage } from "./pages/AccessDeniedPage";

const STAFF = ["SYSTEM_ADMIN", "OWNER", "MANAGER", "EMPLOYEE"] as const;

function HomeRedirect() {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if ((STAFF as readonly string[]).includes(user.activeRole)) return <Navigate to="/dashboard" replace />;
  if (user.activeRole === "BOOTH_OWNER") return <Navigate to="/booth-pricing" replace />;
  return <Navigate to="/portal" replace />;
}

export function App() {
  const { loading, user, needsSetup } = useAuth();
  const location = useLocation();
  if (loading) return null;

  // Nobody has ever completed the first-run Setup Wizard on this deployment and
  // there's no session — force every route to it rather than showing a Login page
  // for a shop that doesn't exist yet. An existing session always means setup
  // already happened (needsSetup is only meaningful pre-login).
  if (!user && needsSetup && location.pathname !== "/setup") {
    return <Navigate to="/setup" replace />;
  }

  return (
    <Routes>
      <Route path="/setup" element={needsSetup ? <SetupWizardPage /> : <Navigate to="/" replace />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/access-denied" element={<Shell><AccessDeniedPage /></Shell>} />

      <Route path="/dashboard" element={<RequireRole roles={[...STAFF]}><Shell><DashboardPage /></Shell></RequireRole>} />
      <Route path="/inventory" element={<RequireRole roles={[...STAFF]}><Shell><InventoryPage /></Shell></RequireRole>} />
      <Route path="/inventory/:id" element={<RequireRole roles={[...STAFF]}><Shell><ItemDetailPage /></Shell></RequireRole>} />
      <Route
        path="/intake"
        element={
          <RequireRole roles={[...STAFF, "CONSIGNOR", "BOOTH_OWNER"]}>
            <Shell>
              <IntakePage />
            </Shell>
          </RequireRole>
        }
      />
      <Route
        path="/pos"
        element={
          <RequireRole roles={[...STAFF, "REGISTER"]}>
            <Shell>
              <PosPage />
            </Shell>
          </RequireRole>
        }
      />
      <Route path="/accounts" element={<RequireRole roles={[...STAFF]}><Shell><AccountsPage /></Shell></RequireRole>} />
      <Route path="/accounts/:id" element={<RequireRole roles={[...STAFF]}><Shell><AccountsPage /></Shell></RequireRole>} />
      <Route
        path="/portal"
        element={
          <RequireRole roles={["CONSIGNOR", "VENDOR", "DONOR"]}>
            <Shell>
              <ConsignorPortalPage />
            </Shell>
          </RequireRole>
        }
      />
      <Route
        path="/booth-pricing"
        element={
          <RequireRole roles={["BOOTH_OWNER", "MANAGER", "OWNER"]}>
            <Shell>
              <BoothOwnerPricingPage />
            </Shell>
          </RequireRole>
        }
      />
      <Route
        path="/reports"
        element={
          <RequireRole roles={["SYSTEM_ADMIN", "OWNER", "MANAGER"]}>
            <Shell>
              <ReportsPage />
            </Shell>
          </RequireRole>
        }
      />
      <Route
        path="/settings"
        element={
          <RequireRole roles={["SYSTEM_ADMIN", "OWNER", "MANAGER"]}>
            <Shell>
              <SettingsPage />
            </Shell>
          </RequireRole>
        }
      />

      <Route path="/" element={<HomeRedirect />} />
      <Route path="*" element={<HomeRedirect />} />
    </Routes>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
