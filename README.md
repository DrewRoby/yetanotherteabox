# Teabox ERP

A working implementation of the "consignment-shop-in-a-box" ERP described in this
repo's planning docs (`project_requirements_document.md`, `tech_stack_document.md`,
`backend_structure_document.md`, `security_guideline_document.md`,
`app_flow_document.md`) and the 12-item build list in `tasks.json`: active-role-only
RBAC, account-linked item intake, a POS inventory search modal, and account-type
differentiation.

See `/home/crow/.claude/plans/zippy-frolicking-rocket.md` (or ask Claude) for the full
build plan, including which parts of the original spec (Postgres, Azure/DigitalOcean
cloud sync, real hardware, Hyperledger, multi-store marketplace) were deliberately
simplified into stub adapters for this sandboxed build, and why.

## Structure

- `server/` — Node.js + Express + TypeScript + Prisma (SQLite) API.
- `web/` — React + TypeScript + Vite + Tailwind client (Ming Dynasty theme).
- `wireframes/` — original static HTML mockups the screens were built from.
- `install.sh` / `dist-bin/` — the packaged Linux executable and its installer (see
  "Try it as a new shop owner" below).

## Try it as a new shop owner (the executable)

This is the easiest way to see Teabox the way a real first-time shop owner would —
no Node, no npm, no database setup on their end.

```bash
./install.sh
```

This only runs on Linux (by design — see "Packaging" below). It installs a single
prebuilt binary to `~/.local/bin/teabox`, starts it, and opens your browser to it.
With no shop set up yet, you land on a first-run **Setup Wizard**: name your shop,
create your Owner login, and you're signed straight in to an empty dashboard ready
for real inventory. Run `~/.local/bin/teabox` any time afterward to reopen it; your
data persists at `~/.local/share/teabox/`.

If `dist-bin/teabox` doesn't exist yet, build it first (see "Packaging").

## Running it from source (development)

```bash
# Terminal 1 — API on :4000
cd server
npm install
npx prisma migrate dev   # first time only, creates dev.db
npx prisma db seed       # first time only, loads demo data
npm run dev

# Terminal 2 — web client on :5173 (proxies /api to :4000)
cd web
npm install
npm run dev
```

Open http://localhost:5173. If no store has been created yet in `dev.db`, you'll land
on the same first-run Setup Wizard described above instead of a login screen — that's
the real first-time-user path, exercised straight from source. Running
`npx prisma db seed` beforehand (as shown above) skips it and drops you straight into
the seeded demo data instead.

## Demo logins

The seed script (`prisma/seed.ts`) is for local development/demos only — it's a
separate path from the Setup Wizard real owners go through. All seeded accounts use
password `teabox123!`.

| Email | Role(s) | Notes |
|---|---|---|
| `owner@teabox.local` | Owner | Full staff access |
| `sarah@teabox.local` | Manager **and** Consignor | Logs in with a role picker; use "Switch Role" in the header afterward |
| `employee@teabox.local` | Employee | Intake + POS |
| `jane.consignor@example.com` | Consignor | Lands on the Consignor Portal |
| `booth402@example.com` | Booth Owner | Lands on Booth Owner Pricing |

## Packaging (building the Linux executable)

```bash
cd server
npm run build:linux
```

This produces `dist-bin/teabox` — a single ~100MB self-contained Linux x64
executable (server + built web client + Prisma's query engine + a pre-migrated empty
database template, all baked in). It's built with `@yao-pkg/pkg` targeting
`node22-linux-x64`. `install.sh` at the repo root is the intended way to actually
install/run it; see "Try it as a new shop owner" above.

A couple of things worth knowing if you touch the build script
(`server/scripts/build-linux.sh`):
- It downloads its own pinned Node 22 runtime into `server/.build-tools/` (gitignored)
  just to *run* the packager — `@yao-pkg/pkg`'s CLI needs a newer Node than this
  project targets at runtime (18.x) to load one of its own dependencies. This never
  affects the app's runtime Node version or the executable's target platform.
- It invokes `pkg .` (relying on `package.json`'s `bin` field), not `pkg dist/index.js`
  — `@yao-pkg/pkg` only reads the `pkg` config block (which lists the Prisma engine,
  `public/`, and the database template as assets) when the entry is resolved through
  `bin`; passing an explicit file path silently ships a binary missing those files.
- The packaged binary stores its data at `$XDG_DATA_HOME/teabox` (or
  `~/.local/share/teabox`), copying in the bundled empty template database on first
  run — see `server/src/bootstrap.ts`.

### Windows test-deploy build

Linux is still the primary distribution target, but a Windows x64 build also exists
for on-site test deploys — e.g. carrying Teabox on a USB drive to a Windows 11 PC
with no dev tooling installed.

```bash
cd server
npm run build:windows
```

This cross-builds `dist-bin/teabox.exe` from Linux (`@yao-pkg/pkg` just fetches a
prebuilt Windows Node binary and patches it — it doesn't need to run on Windows).
Unlike the Linux build's XDG data dir, the Windows build is **portable by design**:
`teabox.exe` looks for `teabox.db` and an optional `config.env` (see
`config.env.example` at the repo root) right next to itself, so the exe, its config,
and its database can be copied around — USB drive, another folder, a backup — as one
unit. It creates `teabox.db` from the bundled empty template on first run and prints
its full path to the console, along with the URL, before opening your default
browser automatically.

To actually run it on the Windows machine: copy `dist-bin/teabox.exe`, `install.bat`,
and (optionally) a `config.env` made from `config.env.example` into one folder —
that's the whole "installer" — and double-click `install.bat` (or `teabox.exe`
directly afterward). No separate install step copies files elsewhere, so the folder
you run it from is where your data lives.

This target needs `prisma/schema.prisma`'s `generator client` to list `"windows"` in
`binaryTargets` (already set) so `npx prisma generate`/`npm install` fetches the
Windows query engine binary alongside the native one.

#### If teabox.exe won't start

Double-clicking a Windows console app closes its window the instant the process
exits, so a fast crash can look like nothing happened at all. `install.bat` runs a
20-second health check against `/api/health` and will tell you plainly if Teabox
didn't come up — don't take its earlier "ok" messages as proof it's running, only the
final check. If it fails, or you ran `teabox.exe` directly and it vanished:

1. Look for `teabox-error.log` next to `teabox.exe` (falls back to `%TEMP%` if that
   folder isn't writable) — every fatal error is appended there before the window is
   held open with a `pause`, so a genuine crash should now stay on screen and get
   logged either way.
2. **Port already in use** — the most common cause if you tried more than once: check
   Task Manager for a leftover `teabox.exe` process and close it, or set
   `PORT=<something else>` in `config.env`.
3. **Running straight off the USB stick** — if the drive (or its filesystem) isn't
   writable, creating `teabox.db` fails immediately. Copy the whole folder onto the
   PC's own drive first.
4. **Antivirus/SmartScreen** — pkg-built, unsigned executables are frequently flagged
   by Windows Defender; check Windows Security → Protection history for a blocked or
   quarantined `teabox.exe`.
5. **Missing Visual C++ Redistributable** — Prisma's Windows query engine is a native
   module that needs the Microsoft Visual C++ Redistributable (x64) installed; a
   `teabox-error.log` mentioning the query engine or a `.node` file points here.

## What's real vs. simulated

Real: auth/JWT active-role sessions, RBAC enforcement, Prisma/SQLite persistence,
intake→inventory→POS→sale→payout business logic, reports computed from live data, CSV
export.

Simulated (clearly marked `// STUB` in `server/src/adapters/`): thermal printer
(writes a rendered ticket to `server/var/print-jobs/` instead of talking ESC/POS to a
real Epson printer), computer-vision metadata suggestions, outbound email, and cloud
sync heartbeat. No Hyperledger blockchain or multi-store marketplace backend is
implemented — Settings' Blockchain tab is a placeholder.

To point at a real Postgres instance instead of the bundled SQLite file, change the
`provider` in `server/prisma/schema.prisma`'s `datasource` block and update
`DATABASE_URL` in `server/.env`.
