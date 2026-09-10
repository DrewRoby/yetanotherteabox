import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { ROLE_LABELS, type Role } from "../auth/roles";
import type { RoleOption } from "../auth/AuthContext";
import { ApiError } from "../api/client";

export function LoginPage() {
  const { login, selectRole, user } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (user) navigate("/", { replace: true });
  }, [user, navigate]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pendingUserId, setPendingUserId] = useState<string | null>(null);
  const [roleOptions, setRoleOptions] = useState<RoleOption[]>([]);
  const [selected, setSelected] = useState<RoleOption | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = await login(email, password);
      if (result.needsRoleSelection && result.roles && result.userId) {
        setPendingUserId(result.userId);
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
    if (!pendingUserId || !selected) return;
    setSubmitting(true);
    try {
      await selectRole(pendingUserId, selected.role, selected.storeId);
      navigate("/");
    } catch {
      setError("Could not sign in with that role.");
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
          {pendingUserId ? "SELECT ROLE" : "LOGIN"}
        </div>

        <div className="px-11 pb-11 pt-5">
          {!pendingUserId ? (
            <form onSubmit={handleSubmit} className="flex flex-col gap-7">
              <div>
                <label className="block text-xs font-extrabold uppercase tracking-wide mb-2">Email</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
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
    </div>
  );
}
