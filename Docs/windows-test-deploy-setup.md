# Windows test-deploy: first-time setup

Covers the Windows x64 package (`dist-bin/teabox.exe`, see root `CLAUDE.md` and
`README.md`'s "Windows test-deploy build" section): building it, where its data
actually lives, wiping it back to a true first-run state, driving the Setup Wizard
from `config.env` instead of the browser, and hand-generating a clean database
without a full rebuild. Assumes Node.js and Git for Windows (Git Bash) are installed.

## Building

```bash
cd server
npm run build:windows
```

Produces `dist-bin/teabox.exe` at the repo root. This now works whether you're
cross-building from Linux or running it natively on Windows under Git Bash — the
script detects the host and fetches the matching pkg-runner Node itself. Run it via
`npm run build:windows` (not `sh build-windows.sh` directly) so the script's
self-location resolves correctly regardless of where your shell's cwd happens to be;
if it ever does land on the wrong directory, it now fails immediately with a clear
message instead of a confusing `npm error... package.json` three directories away.

## Where the data actually lives

`teabox.exe` is portable by design: on first launch it creates `teabox.db` **next to
wherever the exe is actually running from** (`server/src/bootstrap.ts`), not inside
the exe and not necessarily in `dist-bin/`. If you copy `teabox.exe` to a test folder
(as `README.md` describes — exe + `install.bat` + optional `config.env` together),
that folder is where `teabox.db`, `teabox-error.log`, and `print-jobs/` all end up.

The startup console banner prints the exact path:

```
Database file: C:\path\to\wherever\teabox.db
```

Trust that line over assumptions about where you think you launched it from.

## Resetting to a true first run

**Rebuilding the exe does not reset data.** `npm run build:windows` only regenerates
`teabox.exe` and a fresh *internal* template (`prisma/template.db`, baked into the
exe) used the first time a `teabox.db` doesn't exist yet. `bootstrap.ts` checks
`fs.existsSync(dbPath)` and leaves an existing `teabox.db` completely alone — so an
old "dummy" account surviving a rebuild almost always means either:

- You're running the exe from a different folder than the one you rebuilt/cleared
  (check the "Database file:" banner line above), or
- A previous `teabox.exe` process is still running and holding `teabox.db` open,
  which can make a delete silently fail or leave a stale copy — check Task Manager
  for a leftover `teabox.exe` and close it first.

To actually wipe it:

1. Close any running `teabox.exe` (Task Manager if needed).
2. Delete `teabox.db` (and, if you want a fully clean slate, `teabox-error.log` and
   the `print-jobs/` folder) from the folder you actually run the exe from.
3. Relaunch `teabox.exe` (or `install.bat`). It recreates `teabox.db` from the
   bundled template and you land back on the Setup Wizard — or, if `config.env` has
   the `SETUP_*` vars below set, setup completes automatically instead.

## Driving setup from `config.env` instead of the browser

By default, a fresh `teabox.db` shows the manual Setup Wizard. For a repeatable test
deploy where you want the same known owner login every time without re-typing it,
set all four of these together in `config.env` (copy from `config.env.example`):

```ini
SETUP_STORE_NAME=My Resale Shop
SETUP_STORE_LOCATION=Springfield, IL   # optional
SETUP_OWNER_NAME=Jane Owner
SETUP_OWNER_EMAIL=owner@example.com
SETUP_OWNER_PASSWORD=change-me-to-something-real
```

On startup, `maybeAutoCompleteSetup()` (`server/src/services/setup.service.ts`) runs
*before* the server accepts its first request. If the four required vars
(`SETUP_STORE_NAME`/`SETUP_OWNER_NAME`/`SETUP_OWNER_EMAIL`/`SETUP_OWNER_PASSWORD`) are
all present **and** the database is still fresh (`needsSetup` true), it creates the
store and owner directly and skips the wizard — you're dropped straight onto the
login screen already able to sign in.

Notes:

- All four required vars must be set together. A partial set logs a warning to the
  console and falls back to the manual wizard rather than guessing at defaults.
- Once a store exists, these vars are inert — safe to leave them in `config.env`
  across restarts; they only ever fire against an empty database.
- `SETUP_OWNER_PASSWORD` sits in `config.env` as plain text, same tradeoff the file
  already makes for `JWT_SECRET`. Fine for a short on-site test deploy; don't reuse a
  real password, and treat the file as sensitive once it holds one.

## Generating a fresh database by hand (without rebuilding the exe)

The build script itself does this to produce the empty template baked into every new
exe — the same technique works standalone if you want a clean `teabox.db` without
recompiling anything:

```bash
cd server
rm -f prisma/scratch.db prisma/scratch.db-journal
DATABASE_URL="file:scratch.db" npx prisma migrate deploy
```

This applies every migration in `prisma/migrations/` to a brand-new file and exits —
no seed data, no demo accounts, just the schema. Then drop it in as `teabox.db`:

```bash
mv prisma/scratch.db "/path/to/your/test/folder/teabox.db"
```

**Two path gotchas, both specific to Prisma + SQLite + Windows, found while testing
this:**

1. **Use a relative filename, not an absolute path, for the `DATABASE_URL` above.**
   Prisma resolves a relative SQLite `file:` path relative to `schema.prisma`'s own
   directory (`server/prisma/`) — *not* your shell's current directory. That's why
   `scratch.db` above lands in `server/prisma/scratch.db` even though you're standing
   in `server/`. It's also exactly what `build-windows.sh` relies on for
   `prisma/template.db`.
2. **Never pass a Git-Bash-style path (`/c/Users/...`) as an absolute `DATABASE_URL`.**
   Prisma's Windows query/migration engine is a native Windows binary — it has no
   idea `/c/...` means `C:\...`; it reads the leading `/` as "root of the current
   drive" and silently creates a literal `C:\c\Users\...` directory tree instead
   (confirmed by hand: `DATABASE_URL="file:/c/Users/.../fresh.db" npx prisma migrate
   deploy` reported success but the file was nowhere near where it looked created).
   If you need an absolute path, use real Windows drive-letter form with forward
   slashes instead: `file:C:/Users/.../teabox.db`. This is the same
   backslash-vs-forward-slash class of issue `bootstrap.ts` already normalizes for
   the packaged exe's own portable-mode `DATABASE_URL` — it just resurfaces
   differently (wrong drive notation, not wrong slash direction) when you're typing
   one by hand in Git Bash.
