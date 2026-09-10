import { Link } from "react-router-dom";

export function AccessDeniedPage() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4">
      <h1 className="text-2xl font-bold text-crimson">Access Denied</h1>
      <p className="text-gray-500">Your active role does not have permission to view this page.</p>
      <Link to="/dashboard" className="text-sm underline decoration-gold decoration-2 underline-offset-4">
        Back to Dashboard
      </Link>
    </div>
  );
}
