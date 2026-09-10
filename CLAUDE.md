# Teabox ERP

Consignment-shop-in-a-box ERP. Implements the planning docs at repo root
(`project_requirements_document.md`, `tech_stack_document.md`,
`backend_structure_document.md`, `security_guideline_document.md`,
`app_flow_document.md`) and the 12-task punch list in `tasks.json`, which is the
authoritative scope for four things: **active-role-only RBAC**, **account-linked item
intake**, a **POS inventory search modal**, and **account-type differentiation**. The
docs describe a much bigger system (multi-store marketplace, blockchain escrow, real
hardware/cloud) — none of that is built; see "Deliberately not built" below.
`wireframes/*.html` are the static mockups every screen was built to match.

## Layout

| Path | What |
|---|---|
| `server/` | Node/Express/TypeScript/Prisma API. See `server/CLAUDE.md`. |
| `web/` | React/TypeScript/Vite/Tailwind client. See `web/CLAUDE.md`. |
| `install.sh`, `dist-bin/teabox` | Primary Linux packaged executable + installer. |
| `install.bat`, `dist-bin/teabox.exe`, `config.env.example` | Windows x64 build for on-site test deploys (portable: exe/config/db stay together, no XDG dir). Built with `cd server && npm run build:windows`; see README's "Windows test-deploy build". |
| `wireframes/` | Reference mockups (Ming Dynasty theme: crimson `#b91c1c`, gold `#d4af37`, ink `#1a1a1a`, bone `#f8f3e7`). |
| `*_document.md`, `tasks.json` | Original spec. Consult before adding features not yet built (e.g. marketplace) to check intended shape. |
| `Docs/Migrations/` | Living specs for migrating another shop's data into Teabox — `sql_server_data_model_migration_spec.md` (first source: Liberty by ResaleWorld) plus `liberty-etl/` (the actual profiling/transform/load tool, not shipped product code). Update the spec alongside `schema.prisma`/`enums.ts` changes that affect what a migration must produce, then run `cd server && npm run check:migration-spec -- --write` to re-stamp it (plain `npm run check:migration-spec` fails if the spec is stale relative to those two files). |

## Two ways to boot the app

1. **Dev**: `server` (`npm run dev`, :4000) + `web` (`npm run dev`, :5173, proxies `/api`). Needs `prisma migrate dev` once; `prisma db seed` for demo data (see `server/prisma/seed.ts`), otherwise empty.
2. **Packaged**: `./install.sh` (Linux only) installs/runs `dist-bin/teabox`, a single self-contained binary (server + built web client + Prisma engine + empty DB template baked in). Data lives at `~/.local/share/teabox/`. Rebuild via `cd server && npm run build:linux`. For a Windows test deploy instead, see `install.bat` / `dist-bin/teabox.exe` in the Layout table above — same idea, but portable (exe/config/db together) rather than an XDG data dir.

Both paths converge on the same first-run behavior: zero stores in the DB →
every route redirects to the **Setup Wizard** (`/setup`), which creates the store +
Owner account and signs them in. This is the real "new shop owner" path;
`prisma/seed.ts` is a separate, dev-only shortcut that pre-populates demo data instead.

## The one rule that shapes everything

**Authorization reads only the active role in the session token — never the union of
a user's roles.** A person can hold multiple roles (e.g. Manager *and* Consignor) but
each login session is bound to exactly one, chosen at login (role picker) or via
"Switch Role" in the header. This is enforced server-side (`requireRole` middleware
reads `req.session.activeRole` only) and is the reason `UserRole` is a separate table
from `User` rather than a roles array on the user. See `server/CLAUDE.md` for the
token shape and the intake/POS/account rules that follow from it.

## Deliberate simplifications vs. the planning docs

- **SQLite only**, not Postgres+SQLite-fallback (zero external services to run; doubles as the docs' own "offline fallback" concept). Swap `server/prisma/schema.prisma`'s datasource to switch.
- **TypeScript** throughout; **Vite** instead of raw Webpack for the client.
- **No Docker/CI/cloud hosting**, no Hyperledger, no multi-store marketplace backend (no wireframe for it either, and not in `tasks.json`).
- Real hardware/cloud/CV/email are **stub adapters** in `server/src/adapters/` (clearly commented `STUB:`) — same interface a real integration would use, but they log/write locally instead of calling out. Business logic and data (Prisma/SQLite, RBAC, intake→POS→sale→payout) are real.

## Known gotchas already fixed once (don't reintroduce)

- **Local vs. UTC dates**: report bucketing must key by local calendar date consistently (see `localDateKey` in `server/src/routes/reports.routes.ts`) — mixing `toISOString()` with locale-based ranges silently drops "today" near a UTC day boundary.
- **Post-login/role-switch navigation** must go through the role-aware redirect (`HomeRedirect` in `web/src/App.tsx`), never a hardcoded path — a Consignor/Booth Owner sent to `/dashboard` hits Access Denied.
- **`tsc` output layout**: `server` has a separate `tsconfig.build.json` (`rootDir: "src"`) from the dev/typecheck `tsconfig.json` (which also includes `prisma/` for seed-script typechecking) — the two must not be merged, or `dist/index.js`'s `__dirname`-relative paths (static files, DB template) break.
- **`@yao-pkg/pkg`** only reads `package.json`'s `pkg` asset config when invoked as `pkg .` (via the `bin` field) — an explicit entry-file argument silently ships a binary missing the listed assets. See `server/scripts/build-linux.sh`.
