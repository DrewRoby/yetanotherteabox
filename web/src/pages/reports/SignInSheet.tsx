import { useEffect, useState } from "react";
import { api, ApiError } from "../../api/client";
import { useAuth } from "../../auth/AuthContext";
import { ROLE_LABELS, type Role } from "../../auth/roles";
import { Button, Card } from "../../components/Card";
import { CodeFormatToggle } from "./CodeFormatToggle";
import { codeFilename, downloadDataUrl, renderCodeToDataUrl, type CodeFormat } from "../../lib/codeImage";

interface EligibleUser {
  userId: string;
  name: string;
  email: string;
  roles: Role[];
  badgeIssuedAt: string | null;
}

interface IssuedBadge {
  userId: string;
  name: string;
  roles: Role[];
  code: string;
  image: string; // PNG data URL
}

// Reports > Employee Sign-In Sheet. Prints one scan-to-login badge per selected
// employee (see server/src/services/badge.service.ts). The server only keeps a hash of
// each code, so the plaintext codes live in this component's state for exactly as long
// as the sheet is on screen — generating a sheet always rotates the selected
// employees' badges, and leaving the tab discards the codes.
export function SignInSheet() {
  const { user } = useAuth();
  const [users, setUsers] = useState<EligibleUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [format, setFormat] = useState<CodeFormat>("BARCODE");
  const [sheet, setSheet] = useState<IssuedBadge[] | null>(null);
  const [sheetFormat, setSheetFormat] = useState<CodeFormat>("BARCODE");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const rows = await api.get<EligibleUser[]>("/reports/sign-in-sheet");
    setUsers(rows);
    setLoading(false);
    return rows;
  }

  useEffect(() => {
    load().then((rows) => setSelected(new Set(rows.map((r) => r.userId))));
  }, []);

  function toggle(userId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }

  async function handleGenerate() {
    const rotating = users.filter((u) => selected.has(u.userId) && u.badgeIssuedAt);
    if (
      rotating.length > 0 &&
      !window.confirm(
        `${rotating.length === 1 ? `${rotating[0].name} already has` : `${rotating.length} of the selected employees already have`} a badge. Generating a new sheet replaces their badges — the old printed ones will stop working. Continue?`
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const issued = await api.post<Omit<IssuedBadge, "image">[]>("/reports/sign-in-sheet/issue", {
        userIds: Array.from(selected),
      });
      const withImages = await Promise.all(
        issued.map(async (b) => ({ ...b, image: await renderCodeToDataUrl(b.code, format, { showText: false }) }))
      );
      setSheet(withImages);
      setSheetFormat(format);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not generate the sign-in sheet.");
    } finally {
      setBusy(false);
    }
  }

  async function handleRevoke(u: EligibleUser) {
    if (!window.confirm(`Revoke ${u.name}'s badge? They'll need to sign in with their password until a new sheet is printed.`)) return;
    try {
      await api.del(`/reports/sign-in-sheet/${u.userId}`);
      setSheet((prev) => prev?.filter((b) => b.userId !== u.userId) ?? null);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not revoke that badge.");
    }
  }

  if (sheet) {
    return (
      <div>
        <div className="no-print flex flex-wrap items-center gap-3 mb-4">
          <Button onClick={() => window.print()}>Print Sheet</Button>
          <Button variant="outline" onClick={() => setSheet(null)}>
            Done
          </Button>
          <p className="text-xs text-gray-600 max-w-xl">
            These codes are shown only now — print or download them before leaving this screen. Anyone holding this
            sheet can sign in as these employees, so keep it somewhere staff-only.
          </p>
        </div>

        <div className="print-area bg-white border border-ink p-8">
          <div className="flex justify-between items-end border-b-2 border-gold pb-3 mb-6">
            <div>
              <h2 className="text-lg font-bold uppercase tracking-wide">Employee Sign-In Sheet</h2>
              <div className="text-xs text-gray-600">{user?.storeName}</div>
            </div>
            <div className="text-xs text-gray-600">Printed {new Date().toLocaleDateString()}</div>
          </div>
          <div className="grid grid-cols-2 gap-6">
            {sheet.map((b) => (
              <div key={b.userId} className="border border-ink p-4 flex flex-col items-center text-center break-inside-avoid">
                <div className="font-bold text-lg">{b.name}</div>
                <div className="text-[10px] uppercase tracking-wide text-gray-600 mb-3">
                  {b.roles.map((r) => ROLE_LABELS[r]).join(" · ")}
                </div>
                <img
                  src={b.image}
                  alt={`Sign-in ${sheetFormat === "QR" ? "QR code" : "barcode"} for ${b.name}`}
                  className={sheetFormat === "QR" ? "w-36 h-36" : "max-w-full h-20"}
                />
                <button
                  onClick={() => downloadDataUrl(b.image, codeFilename(`${b.name} badge`, sheetFormat))}
                  className="no-print mt-2 text-[11px] font-bold uppercase text-crimson hover:underline"
                >
                  Download PNG
                </button>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-gray-500 mt-6 text-center">
            Scan your code at the Teabox login screen to sign in. Reprinting this sheet replaces these codes.
          </p>
        </div>
      </div>
    );
  }

  return (
    <Card>
      <div className="flex flex-wrap justify-between items-start gap-4 mb-4">
        <div className="max-w-xl">
          <h3 className="font-bold uppercase tracking-wide">Employee Sign-In Sheet</h3>
          <p className="text-xs text-gray-600 mt-1">
            One scan-to-login code per employee. Badges sign in as Manager, Employee, or Register only — Owner, Admin,
            and consignor access always need a password.
          </p>
        </div>
        <CodeFormatToggle value={format} onChange={setFormat} />
      </div>

      {loading ? (
        <p className="text-gray-500">Loading…</p>
      ) : (
        <table className="w-full text-sm mb-4">
          <thead>
            <tr>
              <th className="p-2 border-b-2 border-gold w-8">
                <input
                  type="checkbox"
                  aria-label="Select all"
                  checked={users.length > 0 && selected.size === users.length}
                  onChange={(e) => setSelected(e.target.checked ? new Set(users.map((u) => u.userId)) : new Set())}
                />
              </th>
              <th className="text-left p-2 border-b-2 border-gold text-xs uppercase">Employee</th>
              <th className="text-left p-2 border-b-2 border-gold text-xs uppercase">Badge Roles</th>
              <th className="text-left p-2 border-b-2 border-gold text-xs uppercase">Current Badge</th>
              <th className="p-2 border-b-2 border-gold" />
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.userId} className="border-b border-gray-100">
                <td className="p-2 text-center">
                  <input type="checkbox" aria-label={`Select ${u.name}`} checked={selected.has(u.userId)} onChange={() => toggle(u.userId)} />
                </td>
                <td className="p-2">
                  <div className="font-bold">{u.name}</div>
                  <div className="text-xs text-gray-500">{u.email}</div>
                </td>
                <td className="p-2 text-xs">{u.roles.map((r) => ROLE_LABELS[r]).join(", ")}</td>
                <td className="p-2 text-xs">
                  {u.badgeIssuedAt ? `Issued ${new Date(u.badgeIssuedAt).toLocaleDateString()}` : <span className="text-gray-400">None</span>}
                </td>
                <td className="p-2 text-right">
                  {u.badgeIssuedAt && (
                    <button onClick={() => handleRevoke(u)} className="text-[11px] font-bold uppercase text-crimson hover:underline">
                      Revoke
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr>
                <td className="p-4 text-center text-gray-400" colSpan={5}>
                  No Manager, Employee, or Register users yet. Add staff under Settings › Users &amp; Permissions.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}

      {error && <p className="text-crimson text-sm font-semibold mb-3">{error}</p>}
      <Button onClick={handleGenerate} disabled={busy || selected.size === 0}>
        {busy ? "Generating…" : `Generate Sheet (${selected.size})`}
      </Button>
    </Card>
  );
}
