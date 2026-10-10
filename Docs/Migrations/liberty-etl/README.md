# liberty-etl

One-time tool for migrating Liberty by ResaleWorld (SQL Server) — specifically Hidden
Treasures' install (Kirksville, MO) — into Teabox. Not shipped product code, kept out
of `server/` deliberately: its `@prisma/client` is required directly from
`server/node_modules` (see `load/prisma.ts`) rather than duplicated here. Read
`../sql_server_data_model_migration_spec.md` §3.1 first — this tool's job was to
confirm or correct that spec against the real database, then execute the migration it
describes; the spec is the authoritative write-up, this README is just how to run
the tool.

**Status (2026-09-07): real migration complete.** Loaded into the packaged app's
actual runtime database, not a scratch file — 3,395 accounts, 756,418 items, 738,509
sales, 50,552 payouts, and a real `OWNER` login for Sherry Stacey, all validated
(`npm run validate`) and confirmed with a live login against the running binary.

**2026-10-10 re-run** from a fresh Liberty backup, on Windows against native SQL
Server Express into the `dist-bin/` Windows package (see "Windows / native SQL Server
Express" below). `scripts/migrate.ts` had to learn to populate `Item.itemNumber`
(required since the `20260915011122_add_item_number` schema migration, which postdates
the first run) — assigned gapless 1..N in intake order, and `npm run validate` now
checks that.

Two items remain excluded from this run, decided project-side (not by Sherry
directly — see spec §9) to unblock the migration rather than guess with real money on
the line:

- **The `CLIENT_TYPE_ID = 3` ("Store Account") accounts** (~46 rows, at least 3
  different real meanings mixed under one type code) and **`CLIENT_ID 101508`** (a
  corrupted ~$2 billion ledger balance) are excluded from every run of
  `scripts/migrate.ts` — see `reports/client_type_3_review.md` for the list still
  waiting on Sherry's sort, and spec §9 for the other open questions.
- `scripts/create-test-login.ts` is now superseded by `config/store.yaml`-driven user
  creation inside `scripts/migrate.ts` itself (see below) — kept around only as a
  quick way to mint an extra smoke-test login against a scratch DB.

### `config/store.yaml`

Defines the shop's identity (name/location — authoritative over whatever free text
ended up in Liberty's own `STORE` table) and every login `scripts/migrate.ts` should
create: the owner (always granted `OWNER`) plus a slot for every other Teabox `Role`.
Staff-role entries are `{name, email, password}`; account-scoped role entries
(`CONSIGNOR`/`VENDOR`/`DONOR`/`BOOTH_OWNER`) also need `account:` matching a migrated
`Account.name` exactly. Hidden Treasures has no logins beyond Sherry today, so every
other role list is empty on purpose — add entries and re-run against a fresh target
when that changes.

`password` is **required** on every entry (owner included) and is used as-is —
bcrypt-hashed at creation time, no random generation, no out-of-band handoff step
(spec §7.2, option 3). That's a deliberate trade for a shop with no legal
data-security/reporting requirement to avoid it: it streamlines setup at the cost of
this file itself holding plaintext passwords — treat `config/store.yaml` as a
credentials file (restrict read access, don't commit it somewhere it'd be exposed),
and change these passwords post-migration if that tradeoff doesn't hold for a given
deployment.

## Prerequisites

- Docker access (the `docker` group, or `sudo`). If `docker ps` fails with a
  permission error even after `sudo usermod -aG docker $USER`, the group grant needs a
  **new login session** to take effect — a new tab in an already-running terminal
  isn't enough. `newgrp docker` inside the current shell works without restarting.
- `cp .env.example .env` and fill in `MSSQL_PASSWORD` (matches `db-analysis/.env`'s
  `MSSQL_SA_PASSWORD`). `TEABOX_DATABASE_URL` in `.env` is just a convenience default
  for local dry runs — the real cutover overrides it inline per-command (see step 2)
  to target the packaged app's actual runtime DB, not this file's value.
- `npm install`

## 0. Restore the source backup

From `/home/crow/code/fetters/db-analysis`:

```
mkdir -p backups
cp "<path to the current RWD.BAK>" backups/RWD.bak
docker compose up -d
docker compose exec mssql /opt/mssql-tools18/bin/sqlcmd -C -S localhost -U sa -P "$MSSQL_SA_PASSWORD" \
  -Q "RESTORE FILELISTONLY FROM DISK = '/backups/RWD.bak'"
```

The `FILELISTONLY` output gives the backup's actual logical file names (won't match
the container's default paths — for Hidden Treasures' backup they're
`RWD_Empty_Data`/`RWD_Empty_Log`, oddly named but real). Use them in the real restore:

```
docker compose exec mssql /opt/mssql-tools18/bin/sqlcmd -C -S localhost -U sa -P "$MSSQL_SA_PASSWORD" -Q "
RESTORE DATABASE Liberty FROM DISK = '/backups/RWD.bak'
WITH MOVE '<logical_data_file_name>' TO '/var/opt/mssql/data/Liberty.mdf',
     MOVE '<logical_log_file_name>' TO '/var/opt/mssql/data/Liberty_log.ldf',
     REPLACE, STATS = 10;"
```

If this fails with `Msg 3169` naming an old database version, the backup predates
SQL Server's restore-compatibility window — see spec §3.1's history note; that's what
happened with the first `RWD.bak` we were given (a ~20-year-old SQL Server 2000
archive, since moved aside). Get a newer backup rather than fighting that error.

## Windows / native SQL Server Express (instead of Linux/Docker)

Steps 0–2 above assume Linux + a dockerized SQL Server. The same migration also runs
on Windows against a natively installed SQL Server Express instance (first done
2026-10-10 on the `HT_Liberty` PC: SQL Server 2022 Express, `.\SQLEXPRESS`, targeting
the Windows test-deploy package in `dist-bin/`). What changes:

| | Linux/Docker | Windows / native SQLEXPRESS |
|---|---|---|
| Backup as delivered | `RWD.bak` | `Rwdback.7rbk` — Liberty's own backup utility output, which is actually a **7-Zip archive** (`RWD.BAK` + `rwd.cfg`). Extract `RWD.BAK` with 7-Zip first. |
| Where the `.bak` lives | bind-mounted `/backups` | Any folder the SQL Server **service account** can read. A non-elevated shell can't write to `MSSQL\Backup` under Program Files, so use e.g. `C:\SQLRestore` and grant `NT Service\MSSQL$SQLEXPRESS` read (`icacls C:\SQLRestore /grant "NT Service\MSSQL$SQLEXPRESS:(OI)(CI)RX" /T`). |
| `sqlcmd` auth | `-U sa -P ...` | `-S .\SQLEXPRESS -E` (Windows auth; your login is sysadmin on a self-installed Express instance). SQLEXPRESS ships Windows-auth-only, so there is no usable `sa`. |
| Database name | `Liberty` | `RWD` — matches Liberty's own name (`rwd.cfg`'s `DBName_Prod`). |
| Restore target paths | `/var/opt/mssql/data/...` | `C:\Program Files\Microsoft SQL Server\MSSQL16.SQLEXPRESS\MSSQL\DATA\rwd_data.mdf` / `rwd_log.ldf` (or `SERVERPROPERTY('InstanceDefaultDataPath')`). Logical names are still `RWD_Empty_Data`/`RWD_Empty_Log`. Liberty's backups are SQL Server 2008 R2 format (version 661); SQL 2022 upgrades them in place on restore. |
| ETL → SQL Server connection | `mssql`'s default tedious driver, `sa` over TCP 1433 | `MSSQL_TRUSTED_CONNECTION=true` → `extract/db.ts` uses the optional `msnodesqlv8` driver + the installed "ODBC Driver 18 for SQL Server" with Windows integrated auth over shared memory. No need to enable TCP/IP or mixed-mode auth on the instance. DATETIME decoding was checked to match tedious (`useUTC`). |
| Target Teabox DB | `~/.local/share/teabox/teabox.db` | `dist-bin/teabox.db`, next to `teabox.exe` (portable mode). Use a forward-slash drive-letter URL: `file:C:/code/yetanotherteabox/dist-bin/teabox.db` — never `/c/...` from Git Bash (see root `CLAUDE.md`). |
| Fresh target | copy the baked `template.db` | `teabox.db` is often **not** empty: `dist-bin/config.env`'s `SETUP_*` vars auto-create a Store on first launch, which makes `migrate` refuse to run. Move the old file into `dist-bin/arch/`, then from `server/`: `DATABASE_URL="file:C:/.../dist-bin/teabox.db" npx prisma migrate deploy`. This applies the repo's current migrations, which may be newer than the exe's baked template — fine as long as the new columns are nullable (the exe never migrates at runtime and ignores extra columns), and required anyway because the ETL writes through `server/`'s current Prisma client. |

Windows restore, end to end (PowerShell; adjust the drive letter):

```
& 'C:\Program Files\7-Zip\7z.exe' e D:\Rwdback.7rbk RWD.BAK -oC:\SQLRestore -y
icacls C:\SQLRestore /grant 'NT Service\MSSQL$SQLEXPRESS:(OI)(CI)RX' /T
sqlcmd -S .\SQLEXPRESS -E -Q "RESTORE FILELISTONLY FROM DISK = 'C:\SQLRestore\RWD.BAK'"
sqlcmd -S .\SQLEXPRESS -E -b -Q "ALTER DATABASE RWD SET SINGLE_USER WITH ROLLBACK IMMEDIATE; RESTORE DATABASE RWD FROM DISK = 'C:\SQLRestore\RWD.BAK' WITH MOVE 'RWD_Empty_Data' TO 'C:\Program Files\Microsoft SQL Server\MSSQL16.SQLEXPRESS\MSSQL\DATA\rwd_data.mdf', MOVE 'RWD_Empty_Log' TO 'C:\Program Files\Microsoft SQL Server\MSSQL16.SQLEXPRESS\MSSQL\DATA\rwd_log.ldf', REPLACE, STATS = 20; ALTER DATABASE RWD SET MULTI_USER;"
```

(Drop the `ALTER DATABASE ... SINGLE_USER` part on the very first restore, when `RWD`
doesn't exist yet.) Then set `.env` per `.env.example`'s Windows block, `npm install`
(pulls `msnodesqlv8`; npm may warn that it skipped its install script — harmless, it
ships prebuilt binaries), and run step 2 with the `file:C:/...` URL above. Make sure
`teabox.exe` is **not running** during the load.

## 1. Profile the restored database

```
npm run profile
```

Writes `reports/profile.md`/`.json` — table row counts, per-column null/distinct
stats and sample values, a name-based FK guess pass. Zero-row tables excluded up
front. This is how the real Hidden Treasures schema in spec §3.1 was confirmed;
re-run it if the source database changes (a newer backup, a different shop).

## 2. Migrate

Fill in `config/store.yaml` first (shop identity + who gets which role — see above).
The target DB needs Teabox's schema applied once — for a dry run against a scratch
file, from `server/`:

```
DATABASE_URL="file:<absolute path to your scratch db>" npx prisma migrate deploy
```

For the real cutover, target the packaged app's own runtime DB instead of a scratch
file: build the binary (`cd server && npm run build:linux`), which bakes a fresh
empty, already-migrated `prisma/template.db`; copy that to
`~/.local/share/teabox/teabox.db` (or `$XDG_DATA_HOME/teabox/teabox.db`) *before*
first-launching the binary — `bootstrap.ts` only writes the template there if nothing
exists yet, so this pre-seeds the real path instead of racing it.

Then, from `liberty-etl/`, pointed at whichever file you just prepared:

```
TEABOX_DATABASE_URL="file:<target db path>" npm run migrate     # Accounts/Items/Sales/Payouts/Users — see Status above for scope
TEABOX_DATABASE_URL="file:<target db path>" npm run validate    # checks the spec §5 invariants against what was just loaded
```

`scripts/migrate.ts` is **not idempotent by design** — it refuses to run if the
target DB already has a `Store` row, to avoid silently duplicating data. Delete the
file and re-apply `prisma migrate deploy` (scratch) or re-copy `template.db` (real
runtime path) to start over.

To see the result in the actual running app: install/launch the binary normally
(`../../../install.sh`, or `~/.local/bin/teabox` if already installed) and log in with
whichever email/temp-password pairs `migrate` printed at the end of its run. For a
quick scratch-DB smoke test instead of the real binary:

```
cd ../../../server
PORT=4099 DATABASE_URL="file:<scratch db path>" npx tsx watch src/index.ts
```

then log in via `POST /api/auth/login` and hit `/api/reports/dashboard`,
`/api/accounts`, `/api/pos/inventory-search?q=...`, etc.

## 3. Add/update logins later — `scripts/add-users.ts`

`scripts/migrate.ts` only ever runs once (it refuses a second run once a `Store`
exists). For everything after that — a new hire, giving a consignor a portal login,
adding a manager — edit `config/store.yaml` and run:

```
TEABOX_DATABASE_URL="file:<target db path>" npm run add-users
```

against the live/target DB (e.g. `~/.local/share/teabox/teabox.db` for the packaged
app). This is **idempotent**: it reads the whole config every time but only acts on
the difference — existing `User`/`UserRole` rows are left alone (an account-scoped
grant is updated only if its `account:` name now resolves to a different `Account`),
so re-running with an unchanged config is always a safe no-op. It shares its
create/grant logic with `migrate.ts` (`load/users.ts`) rather than duplicating it.

To add a new person: add a `{name, email, password[, account]}` entry under the
right role in `config/store.yaml` and re-run `add-users` — no need to touch anything
that's already there. Prints a summary of what was created/updated/unchanged, and
warns (without failing) about any account-scoped entry whose `account:` name didn't
match an existing `Account`.

## Layout

- `config/` — `store.yaml` (shop identity + role/login mapping, see above) and its
  loader/validator `loadStoreConfig.ts`.
- `extract/` — typed readers against the restored SQL Server DB (`liberty.ts`) and
  the connection pool (`db.ts`).
- `transform/` — pure mapping functions, one module per Teabox entity, plus
  `crosswalks.ts` (the enum crosswalks — keep in sync with spec §3.1's tables).
- `load/` — `prisma.ts` (imports server's generated client directly), `batch.ts`
  (chunked `createMany` helper, needed at this row count), and `users.ts`
  (config-driven, idempotent User/UserRole create-or-update — shared by `migrate.ts`
  and `add-users.ts`).
- `scripts/` — `profile.ts` (Phase 1), `migrate.ts` (Phase 2 orchestrator — Accounts/
  Items/Sales/Payouts/Users, config-driven, one-time only), `add-users.ts`
  (repeatable bulk-add/update of logins against an already-migrated store, see above),
  `validate.ts` (post-load invariant checks), `create-test-login.ts` (superseded by
  config-driven users; kept only for a quick extra scratch-DB smoke-test login).
- `reports/` — `profile.md`/`.json` (source profiling output) and
  `client_type_3_review.md` (the list waiting on the shop owner).
