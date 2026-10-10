import { lazy, Suspense, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { ROLE_LABELS, type Role } from "../auth/roles";
import type { RoleOption } from "../auth/AuthContext";
import { ApiError } from "../api/client";

const BarcodeScanner = lazy(() => import("../components/BarcodeScanner").then((m) => ({ default: m.BarcodeScanner })));

// Sign-in-sheet badge codes (server/src/services/badge.service.ts) all start with this,
// which is how a scan that lands in the autofocused Email field is recognized.
const BADGE_PREFIX = /^TBXB-/i;

export function LoginPage() {
  const { login, selectRole, badgeLogin, user } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (user) navigate("/", { replace: true });
  }, [user, navigate]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pendingTicket, setPendingTicket] = useState<string | null>(null);
  const [roleOptions, setRoleOptions] = useState<RoleOption[]>([]);
  const [selected, setSelected] = useState<RoleOption | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Set while a badge holder with several badge-eligible roles is picking one; the
  // code is re-sent with the choice (see AuthContext.badgeLogin).
  const [pendingBadge, setPendingBadge] = useState<string | null>(null);
  const [badgeCode, setBadgeCode] = useState("");
  const [cameraOpen, setCameraOpen] = useState(false);
  const pickingRole = pendingTicket !== null || pendingBadge !== null;

  async function handleBadge(rawCode: string) {
    const code = rawCode.trim();
    if (!code || submitting) return;
    setError(null);
    setSubmitting(true);
    setEmail("");
    setBadgeCode("");
    try {
      const result = await badgeLogin(code);
      if (result.needsRoleSelection && result.roles) {
        setPendingBadge(code);
        setRoleOptions(result.roles);
        setSelected(result.roles[0]);
      } else {
        navigate("/");
      }
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 429
          ? "Too many attempts. Try again later."
          : err instanceof ApiError
            ? "Badge not recognized — it may have been replaced by a newer sign-in sheet."
            : "Could not reach the server."
      );
    } finally {
      setSubmitting(false);
    }
  }

  // A USB scanner types the code plus Enter into whatever has focus — normally the
  // autofocused Email field — so a badge scan works without clicking anything first.
  function handleEmailKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && BADGE_PREFIX.test(email.trim())) {
      e.preventDefault();
      handleBadge(email);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = await login(email, password);
      if (result.needsRoleSelection && result.roles && result.ticket) {
        setPendingTicket(result.ticket);
        setRoleOptions(result.roles);
        setSelected(result.roles[0]);
      } else {
        navigate("/");
      }
    } catch (err) {
      setError(err instanceof ApiError ? "Invalid email or password." : "Could not reach the server.");
      setPassword("");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRoleConfirm() {
    if (!selected || (!pendingTicket && !pendingBadge)) return;
    setSubmitting(true);
    try {
      if (pendingBadge) await badgeLogin(pendingBadge, selected);
      else await selectRole(pendingTicket!, selected.role, selected.storeId);
      navigate("/");
    } catch (err) {
      // The password step's role-selection ticket lasts 5 minutes; once it's gone the
      // only way forward is to sign in again, so drop back to the login form.
      if (pendingTicket && err instanceof ApiError && err.status === 401) {
        setPendingTicket(null);
        setPassword("");
        setError("Sign-in expired. Please sign in again.");
      } else {
        setError("Could not sign in with that role.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-bone">
      <div className="fixed top-0 w-full h-[60px] bg-white border-b-2 border-ink flex items-center px-6">
        <div className="w-[34px] h-[34px] bg-crimson text-white flex items-center justify-center font-bold rounded-sm mr-4">茶</div>
        <div className="font-bold uppercase tracking-wide">Teabox ERP</div>
      </div>

      <div className="corner-ticks bg-white border border-ink w-[420px] shadow-xl">
        <div className="bg-crimson text-white text-center py-3 -mt-6 mx-auto w-1/2 font-extrabold tracking-[3px] border border-ink shadow-[0_4px_0_#111]">
          {pickingRole ? "SELECT ROLE" : "LOGIN"}
        </div>

        <div className="px-11 pb-11 pt-5">
          {!pickingRole ? (
            <>
            <form onSubmit={handleSubmit} className="flex flex-col gap-7">
              <div>
                <label className="block text-xs font-extrabold uppercase tracking-wide mb-2">Email</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={handleEmailKeyDown}
                  className="w-full border-0 border-b border-ink bg-transparent py-3 focus:outline-none focus:border-b-2 focus:border-crimson"
                  placeholder="you@store.com"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-xs font-extrabold uppercase tracking-wide mb-2">Password</label>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full border-0 border-b border-ink bg-transparent py-3 focus:outline-none focus:border-b-2 focus:border-crimson"
                  placeholder="••••••••"
                />
              </div>
              {error && <p className="text-crimson text-sm font-semibold">{error}</p>}
              <button
                type="submit"
                disabled={submitting}
                className="w-full py-4 bg-crimson text-white border border-ink font-extrabold uppercase tracking-widest hover:bg-ink transition-colors disabled:opacity-50"
              >
                {submitting ? "Signing in..." : "Access ERP"}
              </button>
            </form>

            <div className="mt-7 pt-5 border-t border-gray-200">
              <label htmlFor="badge-code" className="block text-xs font-extrabold uppercase tracking-wide mb-2">
                Or scan your badge
              </label>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleBadge(badgeCode);
                }}
                className="flex gap-2"
              >
                <input
                  id="badge-code"
                  type="password"
                  autoComplete="off"
                  value={badgeCode}
                  onChange={(e) => setBadgeCode(e.target.value)}
                  className="flex-1 min-w-0 border-0 border-b border-ink bg-transparent py-2 focus:outline-none focus:border-b-2 focus:border-crimson"
                  placeholder="Scan sign-in sheet code"
                />
                <button
                  type="button"
                  onClick={() => setCameraOpen(true)}
                  className="px-3 border border-ink text-[11px] font-bold uppercase hover:bg-bone"
                >
                  Camera
                </button>
              </form>
            </div>
            </>
          ) : (
            <div className="flex flex-col gap-5">
              <p className="text-sm text-gray-600">
                This account holds multiple roles. Choose which role to sign in as — permissions for this
                session are limited to that role only.
              </p>
              <div className="grid grid-cols-2 gap-2">
                {roleOptions.map((r) => (
                  <button
                    key={`${r.role}-${r.storeId}`}
                    type="button"
                    onClick={() => setSelected(r)}
                    className={`border border-ink p-3 text-center text-xs font-semibold uppercase transition-colors ${
                      selected?.role === r.role ? "bg-crimson text-white border-crimson" : "bg-white hover:border-gold"
                    }`}
                  >
                    {ROLE_LABELS[r.role as Role]}
                  </button>
                ))}
              </div>
              {error && <p className="text-crimson text-sm font-semibold">{error}</p>}
              <button
                onClick={handleRoleConfirm}
                disabled={submitting}
                className="w-full py-4 bg-crimson text-white border border-ink font-extrabold uppercase tracking-widest hover:bg-ink transition-colors disabled:opacity-50"
              >
                Continue as {selected ? ROLE_LABELS[selected.role as Role] : "..."}
              </button>
            </div>
          )}

          <div className="mt-6 text-center text-[9px] text-gray-400 uppercase tracking-wide">
            Version v0.1 · Local Mode
          </div>
        </div>
      </div>

      {cameraOpen && (
        <Suspense fallback={null}>
          <BarcodeScanner
            onDetect={(code) => {
              setCameraOpen(false);
              handleBadge(code);
            }}
            onClose={() => setCameraOpen(false)}
          />
        </Suspense>
      )}
    </div>
  );
}
