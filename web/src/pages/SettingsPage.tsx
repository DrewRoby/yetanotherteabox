import { useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { ROLES, ROLE_LABELS, type Role } from "../auth/roles";
import { Button, Card } from "../components/Card";

const TABS = ["Profile", "Users & Permissions", "Notifications", "Hardware", "Cloud Vault", "Blockchain"] as const;

export function SettingsPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState<(typeof TABS)[number]>("Profile");
  const isAdmin = user?.activeRole === "OWNER" || user?.activeRole === "SYSTEM_ADMIN";

  return (
    <div className="flex h-full">
      <nav className="w-48 bg-crimson2 text-white flex flex-col pt-4">
        {TABS.filter((t) => t !== "Users & Permissions" || isAdmin).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`text-left px-5 py-3 text-xs uppercase tracking-wide border-b border-white/10 ${
              tab === t ? "bg-bone text-crimson2 font-bold" : ""
            }`}
          >
            {t}
          </button>
        ))}
      </nav>
      <div className="flex-1 p-8 overflow-y-auto">
        {tab === "Profile" && <ProfileTab />}
        {tab === "Users & Permissions" && isAdmin && <UsersTab />}
        {tab === "Notifications" && <NotificationsTab />}
        {tab === "Hardware" && <HardwareTab />}
        {tab === "Cloud Vault" && <CloudVaultTab />}
        {tab === "Blockchain" && <BlockchainTab />}
      </div>
    </div>
  );
}

function ProfileTab() {
  const { user } = useAuth();
  const [name, setName] = useState(user?.name ?? "");
  const [password, setPassword] = useState("");
  const [saved, setSaved] = useState(false);

  return (
    <Card className="max-w-md">
      <h2 className="font-bold uppercase text-sm mb-4">Profile</h2>
      <label className="block text-xs font-bold uppercase mb-1">Name</label>
      <input value={name} onChange={(e) => setName(e.target.value)} className="w-full border border-ink p-2 mb-4" />
      <label className="block text-xs font-bold uppercase mb-1">New Password</label>
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Leave blank to keep current"
        className="w-full border border-ink p-2 mb-4"
      />
      <Button
        onClick={async () => {
          await api.put("/settings/profile", { name, password: password || undefined });
          setSaved(true);
          setPassword("");
        }}
      >
        Save
      </Button>
      {saved && <p className="text-crimson text-sm mt-2">Saved.</p>}
    </Card>
  );
}

interface UserRoleRow {
  id: string;
  role: Role;
  user: { id: string; email: string; name: string };
  account: { name: string } | null;
}

function UsersTab() {
  const [rows, setRows] = useState<UserRoleRow[]>([]);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("EMPLOYEE");
  const [inviteResult, setInviteResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function reload() {
    api.get<UserRoleRow[]>("/settings/users").then(setRows);
  }
  useEffect(reload, []);

  async function invite() {
    setError(null);
    try {
      const res = await api.post<{ tempPassword: string }>("/settings/users/invite", { email, name, role });
      setInviteResult(`Invited. Temporary password: ${res.tempPassword}`);
      setEmail("");
      setName("");
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not invite user.");
    }
  }

  return (
    <div className="max-w-2xl">
      <Card className="mb-6">
        <h2 className="font-bold uppercase text-sm mb-4">Invite User</h2>
        <div className="grid grid-cols-3 gap-3 mb-3">
          <input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} className="border border-ink p-2" />
          <input placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} className="border border-ink p-2" />
          <select value={role} onChange={(e) => setRole(e.target.value as Role)} className="border border-ink p-2">
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        </div>
        <Button onClick={invite} disabled={!email || !name}>
          Send Invite
        </Button>
        {inviteResult && <p className="text-crimson text-sm mt-2">{inviteResult}</p>}
        {error && <p className="text-crimson text-sm mt-2">{error}</p>}
      </Card>

      <table className="w-full text-sm bg-white border border-ink">
        <thead>
          <tr className="bg-bone">
            <th className="p-2 text-left text-xs uppercase border-b-2 border-gold">Name</th>
            <th className="p-2 text-left text-xs uppercase border-b-2 border-gold">Role</th>
            <th className="p-2 text-left text-xs uppercase border-b-2 border-gold">Account</th>
            <th className="p-2 border-b-2 border-gold" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-gray-100">
              <td className="p-2">
                {r.user.name} <span className="text-gray-400">({r.user.email})</span>
              </td>
              <td className="p-2">{ROLE_LABELS[r.role]}</td>
              <td className="p-2">{r.account?.name || "—"}</td>
              <td className="p-2 text-right">
                <button
                  className="text-crimson text-xs uppercase font-bold"
                  onClick={async () => {
                    await api.del(`/settings/users/roles/${r.id}`);
                    reload();
                  }}
                >
                  Revoke
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function NotificationsTab() {
  const [prefs, setPrefs] = useState({ lowStock: true, intakeComplete: false, pendingRequests: true, scheduledReports: true });
  return (
    <Card className="max-w-md">
      <h2 className="font-bold uppercase text-sm mb-4">Email Notifications</h2>
      {Object.entries(prefs).map(([key, value]) => (
        <label key={key} className="flex items-center gap-2 mb-3 text-sm capitalize">
          <input
            type="checkbox"
            checked={value}
            onChange={(e) => setPrefs((p) => ({ ...p, [key]: e.target.checked }))}
          />
          {key.replace(/([A-Z])/g, " $1")}
        </label>
      ))}
      <p className="text-[11px] text-gray-400 mt-2">
        Preferences are stored locally in this demo; sending is simulated via the server's email stub.
      </p>
    </Card>
  );
}

interface Device {
  id: string;
  name: string;
  type: string;
  status: string;
}

function HardwareTab() {
  const [devices, setDevices] = useState<Device[]>([]);
  function reload() {
    api.get<Device[]>("/settings/devices").then(setDevices);
  }
  useEffect(reload, []);

  return (
    <div className="grid grid-cols-2 gap-5 max-w-3xl">
      {devices.map((d) => (
        <Card key={d.id}>
          <div className="flex justify-between items-center mb-3">
            <span className="font-bold text-xs uppercase">{d.type.replace("_", " ")}</span>
            <span
              className={`text-[10px] font-bold uppercase px-2 py-1 border rounded-full ${
                d.status === "CONNECTED" ? "border-gold text-ink" : "border-crimson2 text-crimson2"
              }`}
            >
              {d.status}
            </span>
          </div>
          <div className="text-sm mb-3">{d.name}</div>
          <Button
            className="w-full"
            onClick={async () => {
              await api.post(`/settings/devices/${d.id}/test-connection`, {});
              reload();
            }}
          >
            Test Connection
          </Button>
        </Card>
      ))}
    </div>
  );
}

function CloudVaultTab() {
  const [lastSynced, setLastSynced] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  function reload() {
    api.get<{ lastSyncedAt: string | null }>("/settings/sync/heartbeat").then((r) => setLastSynced(r.lastSyncedAt));
  }
  useEffect(reload, []);

  return (
    <Card className="max-w-md">
      <h2 className="font-bold uppercase text-sm mb-4">Cloud Storage / System Sync</h2>
      <p className="text-sm mb-2">
        Last synced: <span className="font-bold">{lastSynced ? new Date(lastSynced).toLocaleString() : "never"}</span>
      </p>
      <p className="text-[11px] text-gray-400 mb-4">
        Cloud sync is simulated locally in this build — no external Azure/DigitalOcean endpoint is called.
      </p>
      <Button
        disabled={syncing}
        onClick={async () => {
          setSyncing(true);
          try {
            await api.post("/settings/sync/heartbeat", {});
            reload();
          } finally {
            setSyncing(false);
          }
        }}
      >
        {syncing ? "Syncing…" : "Sync Now"}
      </Button>
    </Card>
  );
}

function BlockchainTab() {
  return (
    <Card className="max-w-md">
      <h2 className="font-bold uppercase text-sm mb-4">Blockchain Network</h2>
      <p className="text-sm text-gray-500">
        Coming soon — the Hyperledger Fabric escrow/inter-store tracking prototype described in the project docs is a
        future phase and is not implemented in this build.
      </p>
    </Card>
  );
}
