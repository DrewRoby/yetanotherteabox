import { useEffect, useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Badge, Button, StatCard } from "../components/Card";

interface Profile {
  name: string;
  accountType: string;
  currentBalance?: number;
  items: { id: string; description: string; status: string; price: number; intakeDate: string }[];
  payouts: { id: string; amount: number; status: string; createdAt: string }[];
}

export function ConsignorPortalPage() {
  const { user } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [requesting, setRequesting] = useState(false);

  function reload() {
    api.get<Profile>("/accounts/me/profile").then(setProfile);
  }
  useEffect(reload, []);

  if (!profile) return <div className="p-8 text-gray-500">Loading…</div>;

  const soldItems = profile.items.filter((i) => i.status === "SOLD");
  const now = new Date();
  const soldThisMonth = soldItems.filter((i) => {
    const d = new Date(i.intakeDate);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  }).length;
  const pendingPayout = profile.payouts
    .filter((p) => p.status === "REQUESTED")
    .reduce((sum, p) => sum + p.amount, 0);
  const showsBalance = profile.currentBalance !== undefined;

  return (
    <div className="max-w-5xl mx-auto p-10">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-2xl font-bold border-b-2 border-gold pb-1">
          {profile.accountType === "DONOR" ? "Donor Portal" : "Consignor Portal"}
        </h1>
        <div className="font-bold">{user?.name}</div>
      </div>

      <div className="grid grid-cols-4 gap-5 mb-10">
        {showsBalance && <StatCard label="Balance" value={`$${profile.currentBalance!.toFixed(2)}`} />}
        <StatCard label="Items on Consignment" value={profile.items.filter((i) => i.status === "AVAILABLE").length} />
        <StatCard label="Sold (MTD)" value={soldThisMonth} />
        {showsBalance ? (
          <StatCard label="Pending Payout" value={`$${pendingPayout.toFixed(2)}`} />
        ) : (
          <StatCard label="Total Realized Sales" value={`$${soldItems.reduce((s, i) => s + i.price, 0).toFixed(2)}`} />
        )}
      </div>

      <div className="flex justify-between items-center border-b border-ink pb-2 mb-4">
        <h3 className="font-bold text-lg">Recent Activity</h3>
        {showsBalance && (
          <Button
            disabled={requesting || (profile.currentBalance ?? 0) <= 0}
            onClick={async () => {
              setRequesting(true);
              try {
                await api.post("/accounts/me/payouts", {});
                reload();
              } finally {
                setRequesting(false);
              }
            }}
          >
            Request Payout
          </Button>
        )}
      </div>

      <table className="w-full text-sm bg-white border border-ink">
        <thead>
          <tr className="bg-ink text-bone">
            <th className="text-left p-3 text-xs uppercase">Date</th>
            <th className="text-left p-3 text-xs uppercase">Item Description</th>
            <th className="text-left p-3 text-xs uppercase">Status</th>
            <th className="text-left p-3 text-xs uppercase">{showsBalance ? "Net Amount" : "Sold Price"}</th>
          </tr>
        </thead>
        <tbody>
          {profile.items.map((i) => (
            <tr key={i.id} className="border-b border-gray-100">
              <td className="p-3">{new Date(i.intakeDate).toLocaleDateString()}</td>
              <td className="p-3">{i.description}</td>
              <td className="p-3">
                <Badge>{i.status}</Badge>
              </td>
              <td className="p-3">${i.price.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
