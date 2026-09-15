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
| `install.bat`, `dist-bin/teabox.exe`, `config.env.example` | Windows x64 build for on-site test deploys (portable: exe/config/db stay together, no XDG dir). Built with `cd server && npm run build:windows` — works cross-built from Linux or run natively on Windows under Git Bash. See README's "Windows test-deploy build" and `Docs/windows-test-deploy-setup.md` for first-run/reset/config-driven-setup details. |
| `wireframes/` | Reference mockups (Ming Dynasty theme: crimson `#b91c1c`, gold `#d4af37`, ink `#1a1a1a`, bone `#f8f3e7`). |
| `*_document.md`, `tasks.json` | Original spec. Consult before adding features not yet built (e.g. marketplace) to check intended shape. |
| `Docs/Migrations/` | Living specs for migrating another shop's data into Teabox — `sql_server_data_model_migration_spec.md` (first source: Liberty by ResaleWorld) plus `liberty-etl/` (the actual profiling/transform/load tool, not shipped product code). Update the spec alongside `schema.prisma`/`enums.ts` changes that affect what a migration must produce, then run `cd server && npm run check:migration-spec -- --write` to re-stamp it (plain `npm run check:migration-spec` fails if the spec is stale relative to those two files). |
| `Docs/windows-test-deploy-setup.md` | Walkthrough for the Windows package: building it, where `teabox.db` actually lives, resetting to a true first run, driving setup from `config.env` instead of the wizard, and hand-generating a fresh database with `prisma migrate deploy` — including two Prisma+SQLite+Windows path gotchas found while writing it (see this file's own gotchas list below). |

## Two ways to boot the app

1. **Dev**: `server` (`npm run dev`, :4000) + `web` (`npm run dev`, :5173, proxies `/api`). Needs `prisma migrate dev` once; `prisma db seed` for demo data (see `server/prisma/seed.ts`), otherwise empty.
2. **Packaged**: `./install.sh` (Linux only) installs/runs `dist-bin/teabox`, a single self-contained binary (server + built web client + Prisma engine + empty DB template baked in). Data lives at `~/.local/share/teabox/`. Rebuild via `cd server && npm run build:linux`. For a Windows test deploy instead, see `install.bat` / `dist-bin/teabox.exe` in the Layout table above — same idea, but portable (exe/config/db together) rather than an XDG data dir.

Both paths converge on the same first-run behavior: zero stores in the DB →
every route redirects to the **Setup Wizard** (`/setup`), which creates the store +
Owner account and signs them in. This is the real "new shop owner" path;
`prisma/seed.ts` is a separate, dev-only shortcut that pre-populates demo data instead.

A third option skips the wizard's browser form entirely: if `SETUP_STORE_NAME` /
`SETUP_OWNER_NAME` / `SETUP_OWNER_EMAIL` / `SETUP_OWNER_PASSWORD` are all set in the
environment (e.g. via `config.env` on the Windows build), `maybeAutoCompleteSetup()`
(`server/src/services/setup.service.ts`) creates the store + Owner from those values
on startup, before the server accepts its first request. Only fires against a fresh
(zero-store) database; inert afterward. See `Docs/windows-test-deploy-setup.md`.

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
- **Prisma SQLite `file:` URLs on Windows need forward slashes, not backslashes.** `path.join`'s native Windows separators (`file:C:\Users\...`) can be misread by Prisma's connector — the drive-letter colon plus backslashes confuses it. `bootstrap.ts`'s portable-mode `DATABASE_URL` normalizes to forward slashes (`file:C:/Users/...`) before setting it; do the same in any new code that builds one.
- **Never pass a Git-Bash-style path (`/c/Users/...`) as an absolute Prisma `DATABASE_URL`**, e.g. when running `prisma migrate deploy` by hand from Git Bash. Prisma's Windows engine is a native binary with no notion of MSYS path translation — it reads the leading `/` as "root of the current drive" and silently creates a literal `C:\c\Users\...` tree instead of erroring. Use a relative filename (resolved relative to `schema.prisma`'s directory, not your shell's cwd) or a real `C:/...` drive-letter path. See `Docs/windows-test-deploy-setup.md` for the full writeup.

## Roadmap toward a real (small) commercial deployment

Discussed 2026-09-14: this app is currently built and hardened as a single install
per shop, not a hosted product. Work is staged in phases so nothing gets built ahead
of an actual decision that would reshape it.

**Phase 0 — abuse hardening (done):**
- `JWT_SECRET` no longer silently falls back to the well-known string in a packaged
  install — `ensurePersistedJwtSecret()` in `server/src/bootstrap.ts` generates a
  random per-install secret on first run and persists it next to the database
  (`jwt-secret` file) if no explicit value is configured.
- Server binds to `127.0.0.1` by default (`HOST` env var to opt into LAN/wider
  exposure) — see `server/src/index.ts` and `config.env.example`. No TLS story exists
  yet, so this prevents a fresh install from being reachable over plain HTTP from
  other devices by default.
- `helmet()` added for standard response headers (CSP left off deliberately — needs
  a dedicated pass tuned against the built web client before enabling).
- Rate limiting (`express-rate-limit`) on `POST /api/auth/login` and
  `/api/auth/select-role` — see `server/src/routes/auth.routes.ts`.
- `CORS_ORIGIN` no longer applied by default in a packaged run (same-origin static
  serving needs no CORS); still applied in dev and whenever `CORS_ORIGIN` is set
  explicitly.
- **Known remaining gap, not yet done**: no forced password rotation after
  `inviteUser`'s temp password — a temp password can quietly become permanent
  forever. Needs a schema change (`User.mustChangePassword` or similar) plus a web
  gate; deferred because it's a bigger change than the rest of this list, not because
  it's unimportant.

**Phase 1 — blocked on client input:**
- Real email delivery to replace the `server/src/adapters/email.ts` stub (needed for
  `inviteUser`'s temp-password email and any real password-reset flow). Waiting on
  the client's email provider/preferences before choosing an integration.

**Phase 2 — backup, not yet started:**
- Real disaster-recovery backup of the local SQLite file — proposed approach is
  Litestream-style continuous WAL shipping to cloud object storage (DO Spaces/S3),
  *not* a database-log-based CDC/event stream (SQLite's `-journal`/`-wal` files are
  page-level and get truncated/checkpointed away — not a semantic change log worth
  building on). Scope this as backup/restore, and the deliverable is a **tested
  restore**, not just "backups are being taken."
- Explicitly not doing here: Kafka/streaming CDC. This DR backup is per-store and
  one-way to cold storage — it's independent of, and needed regardless of, the
  Phase 3 sync direction below.

**Phase 3 — chosen direction (discussed 2026-09-14), not yet built:**

The end goal was never "hosted SaaS." It's a product that keeps running a single
shop with **no live internet dependency**, plus **cross-store browsing** as an
intended feature for operators running more than one location. Those two read as
contradictory (SaaS-style shared visibility vs. offline-first) until split apart:

- *"Must function without internet"* is about **authority** — each store is the sole
  writer of its own data (intake, POS, payouts, consignor balances), always, whether
  or not it can reach anything else. This doesn't change at all from today's
  architecture; `storeId` scoping already does the isolation work.
- *"Cross-store browsing"* is about **visibility into another store's state**, which
  can never be truly real-time for a store that's allowed to be offline — no
  architecture changes that fact. So the only honest version of the feature is "as of
  the last successful sync," which is not a compromise forced by the offline
  requirement, it's just what the feature actually means. Once framed that way, the
  two requirements don't conflict.

Chosen shape — one-way outbox to a dumb cloud aggregator, not a shared live database:

- Every local write appends a row to a per-store, append-only outbox table: entity,
  op, payload, and a **local monotonic sequence number** (not a timestamp — store
  machines can't be assumed to agree on clocks, especially after being offline for
  days). A background job pushes unsent rows whenever connectivity exists.
- The cloud side only ever ingests; it never pushes writes back down as
  authoritative. It materializes everyone's outbox into one **read-only** aggregate
  that any store can query for cross-store browsing when online. It does not need to
  be always-up for any store's own operations to keep working — if it's down, every
  store keeps running and cross-store browsing just goes stale until it's back. This
  is what avoids "SaaS baggage": no uptime SLA on the critical path, no multi-tenant
  isolation hardening, could be one lightweight box per customer/chain rather than a
  universal shared platform.
- Cross-store data is **read-only from every store's perspective** — nobody at Store
  A ever writes into Store B's data. This is what keeps the whole thing simple: no
  merge/conflict-resolution logic needed anywhere, which is normally the expensive
  part of offline-first sync.
- If browsing needs to keep working while the *browsing* store is itself offline,
  cache the last successful pull from the aggregate locally — same trick, one hop
  further down, still read-only so still no merge logic.
- **Watch for this later**: if browsing ever grows an action like an inter-store
  transfer ("ship this item from Store B to Store A"), that's two stores' state
  needing to agree on one fact, which *does* need real coordination (even if it's
  just a request/accept flow, not a live lock). Decide that deliberately when it's
  actually requested — don't back into it.
- `runHeartbeatSync()` in `server/src/adapters/cloudSync.ts` already sketches the
  right shape for the push side (a periodic app-level push, not log tailing).

This also resolves the self-hosted-vs-SaaS framing from earlier: it's neither — each
shop stays a self-contained install (today's model, unchanged), with a thin optional
cloud aggregator layered on top purely for the cross-store read path.
