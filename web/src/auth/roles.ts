// Mirrors server/src/lib/enums.ts. Kept in sync by hand since the two apps don't
// share a package; the server is the source of truth for what it actually enforces.
export const ROLES = [
  "SYSTEM_ADMIN",
  "OWNER",
  "MANAGER",
  "EMPLOYEE",
  "REGISTER",
  "CONSIGNOR",
  "VENDOR",
  "DONOR",
  "BOOTH_OWNER",
] as const;
export type Role = (typeof ROLES)[number];

export const STAFF_ROLES: Role[] = ["SYSTEM_ADMIN", "OWNER", "MANAGER", "EMPLOYEE"];

export const ROLE_LABELS: Record<Role, string> = {
  SYSTEM_ADMIN: "System Admin",
  OWNER: "Owner",
  MANAGER: "Manager",
  EMPLOYEE: "Employee",
  REGISTER: "Register",
  CONSIGNOR: "Consignor",
  VENDOR: "Vendor",
  DONOR: "Donor",
  BOOTH_OWNER: "Booth Owner",
};

// The living role -> screen matrix called for by tasks.json's "Enforce role- and
// function-appropriate screen access" / "Update documentation" items. Each route's
// `roles` list is exactly what AppRoutes.tsx uses to gate access, and exactly what
// Sidebar.tsx uses to decide what to show — one definition, so the doc can't drift
// from the enforcement.
export interface NavEntry {
  path: string;
  label: string;
  roles: Role[];
}

export const NAV_ENTRIES: NavEntry[] = [
  { path: "/dashboard", label: "Dashboard", roles: ["SYSTEM_ADMIN", "OWNER", "MANAGER", "EMPLOYEE"] },
  { path: "/pos", label: "Point of Sale", roles: ["SYSTEM_ADMIN", "OWNER", "MANAGER", "EMPLOYEE", "REGISTER"] },
  { path: "/inventory", label: "Inventory", roles: ["SYSTEM_ADMIN", "OWNER", "MANAGER", "EMPLOYEE"] },
  { path: "/intake", label: "Item Intake", roles: ["SYSTEM_ADMIN", "OWNER", "MANAGER", "EMPLOYEE", "CONSIGNOR", "BOOTH_OWNER"] },
  { path: "/accounts", label: "Accounts", roles: ["SYSTEM_ADMIN", "OWNER", "MANAGER", "EMPLOYEE"] },
  { path: "/portal", label: "My Portal", roles: ["CONSIGNOR", "VENDOR", "DONOR"] },
  { path: "/booth-pricing", label: "Booth Pricing", roles: ["BOOTH_OWNER", "MANAGER", "OWNER"] },
  { path: "/reports", label: "Reports", roles: ["SYSTEM_ADMIN", "OWNER", "MANAGER"] },
  { path: "/settings", label: "Settings", roles: ["SYSTEM_ADMIN", "OWNER", "MANAGER"] },
];
