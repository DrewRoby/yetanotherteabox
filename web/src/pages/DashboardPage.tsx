import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Badge, Button, Card, StatCard } from "../components/Card";

interface DashboardData {
  totalInventory: number;
  dailySalesTotal: number;
  dailySalesCount: number;
  pendingIntake: number;
  pendingPayoutTotal: number;
  activeAccounts: number;
  lastSyncedAt: string | null;
  recentSales: { id: string; description: string; accountName: string; salePrice: number; saleDate: string }[];
}

export function DashboardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState<DashboardData | null>(null);

  useEffect(() => {
    api.get<DashboardData>("/reports/dashboard").then(setData).catch(() => setData(null));
  }, []);

  if (!user) return null;

  return (
    <div className="p-8">
      <div className="text-sm font-bold uppercase tracking-widest text-gray-600 border-b border-gold inline-block pb-1 mb-6">
        Performance Summary
      </div>

      {data ? (
        <div className="grid grid-cols-4 gap-6">
          <StatCard label="Total Inventory" value={data.totalInventory} sub="items available" />
          <StatCard label="Daily Sales" value={`$${data.dailySalesTotal.toFixed(2)}`} sub={`${data.dailySalesCount} transactions today`} />
          <StatCard label="Pending Intake" value={data.pendingIntake} sub="awaiting inspection" />
          <StatCard
            label="Consignor Payouts"
            value={`$${data.pendingPayoutTotal.toFixed(2)}`}
            sub={`${data.activeAccounts} active accounts`}
          />

          <Card className="col-span-3">
            <div className="flex justify-between items-center mb-4 border-l-4 border-crimson pl-3">
              <span className="font-extrabold text-lg">Recent Transactions</span>
              <Button variant="outline" onClick={() => navigate("/reports")}>
                View Reports
              </Button>
            </div>
            <table className="w-full">
              <thead>
                <tr className="text-left text-[11px] uppercase text-gray-500 border-b-2 border-gold">
                  <th className="py-2">Item</th>
                  <th className="py-2">Account</th>
                  <th className="py-2">Amount</th>
                  <th className="py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {data.recentSales.map((s) => (
                  <tr key={s.id} className="border-b border-gray-100">
                    <td className="py-3">{s.description}</td>
                    <td className="py-3">{s.accountName}</td>
                    <td className="py-3">${s.salePrice.toFixed(2)}</td>
                    <td className="py-3">
                      <Badge tone="success">Completed</Badge>
                    </td>
                  </tr>
                ))}
                {data.recentSales.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-6 text-center text-gray-400">
                      No sales yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </Card>

          <Card>
            <div className="font-extrabold text-lg mb-4">Quick Actions</div>
            <div className="flex flex-col gap-3">
              <QuickAction label="New Sale Entry" onClick={() => navigate("/pos")} />
              <QuickAction label="Process Intake" onClick={() => navigate("/intake")} />
              <QuickAction label="Generate Report" onClick={() => navigate("/reports")} />
              <QuickAction label="Inventory Audit" onClick={() => navigate("/inventory")} />
            </div>
          </Card>
        </div>
      ) : (
        <p className="text-gray-500">Loading dashboard…</p>
      )}
    </div>
  );
}

function QuickAction({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="bg-bone border border-ink px-4 py-3 text-left text-sm font-bold flex justify-between items-center hover:border-gold hover:bg-white transition-colors"
    >
      {label} <span>→</span>
    </button>
  );
}
