// Runs before anything else in index.ts (must be the first import — see the comment
// there) so DATABASE_URL is correct before ../lib/prisma constructs a PrismaClient.
//
// Only does anything when running as a pkg-packaged binary (`process.pkg` is set by
// @yao-pkg/pkg at runtime). Plain `npm run dev` / `npm start` are untouched and keep
// using server/.env as before.
import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import { execSync } from "child_process";
import dotenv from "dotenv";
import "dotenv/config";

export const isPackaged = !!(process as unknown as { pkg?: unknown }).pkg;

// Filled in below when packaged, so index.ts can print/announce them at startup.
export let packagedDbPath: string | undefined;
export let packagedConfigPath: string | undefined;

// Every session token is signed with this. The repo (and config.env.example) ship a
// well-known fallback string for zero-config dev/test-deploy convenience — fine on a
// laptop only you can reach, but anyone who can read this public repo can forge a
// valid session for any role against a deployment that's still using it. Rather than
// hard-failing startup (which would break the documented "short test deploy, no
// config.env needed" flow), a packaged install that hasn't been given an explicit
// JWT_SECRET gets a random one generated on first run and persisted next to its
// database, so the well-known fallback never actually signs a real deployment's
// tokens. Regenerating/losing this file invalidates all logged-in sessions but
// nothing else — same blast radius as changing JWT_SECRET by hand.
function ensurePersistedJwtSecret(dir: string) {
  if (process.env.JWT_SECRET) return; // explicit config.env / OS env value always wins

  const secretPath = path.join(dir, "jwt-secret");
  if (fs.existsSync(secretPath)) {
    process.env.JWT_SECRET = fs.readFileSync(secretPath, "utf8").trim();
    return;
  }
  const secret = crypto.randomBytes(32).toString("hex");
  fs.writeFileSync(secretPath, secret);
  process.env.JWT_SECRET = secret;
  console.log(`First run: generated a session-signing secret at ${secretPath}`);
}

// Windows-only, and registered before anything else runs: double-clicking teabox.exe
// (or launching it via install.bat's `start`) opens a console window that Windows
// closes the instant the process exits — on a crash, that means the error flashes by
// too fast to read, which is exactly what makes a packaged Windows exe frustrating to
// debug on-site. So any fatal error gets appended to teabox-error.log next to the exe
// (falling back to %TEMP% if that folder isn't writable — e.g. running straight off a
// write-protected USB stick, a real failure mode this same handler needs to survive)
// and the window is held open with the OS's own `pause` until someone reads it. See
// README's Windows troubleshooting section.
if (isPackaged && process.platform === "win32") {
  const logCandidates = [
    path.join(path.dirname(process.execPath), "teabox-error.log"),
    path.join(os.tmpdir(), "teabox-error.log"),
  ];
  const haltOnFatal = (label: string, err: unknown) => {
    const message = `[${new Date().toISOString()}] ${label}: ${
      err instanceof Error ? err.stack || err.message : String(err)
    }\n`;
    let loggedTo: string | undefined;
    for (const candidate of logCandidates) {
      try {
        fs.appendFileSync(candidate, message);
        loggedTo = candidate;
        break;
      } catch {
        // try the next candidate (most likely cause: the exe's own folder isn't writable)
      }
    }
    console.error(`\n${message}`);
    console.error(loggedTo ? `Details written to: ${loggedTo}` : "Could not write a log file anywhere writable.");
    console.error("");
    try {
      execSync("pause", { stdio: "inherit" }); // keeps this window open instead of vanishing
    } catch {
      // no console attached (e.g. launched detached) — nothing more we can do
    }
    process.exit(1);
  };
  process.on("uncaughtException", (err) => haltOnFatal("Uncaught exception", err));
  process.on("unhandledRejection", (err) => haltOnFatal("Unhandled rejection", err));
}

if (isPackaged) {
  if (process.platform === "win32") {
    // Windows test-deploy target (see server/scripts/build-windows.sh and root
    // CLAUDE.md): deliberately portable rather than XDG-style, so teabox.exe,
    // config.env, and teabox.db can sit together in one folder on a USB drive and be
    // moved/backed up as a unit. Data lives beside the executable itself, not in
    // AppData — `process.execPath` is the real .exe path even under pkg's snapshot fs.
    const portableDir = path.dirname(process.execPath);

    const configPath = path.join(portableDir, "config.env");
    if (fs.existsSync(configPath)) {
      dotenv.config({ path: configPath, override: true });
      packagedConfigPath = configPath;
    }

    const dbPath = path.join(portableDir, "teabox.db");
    if (!fs.existsSync(dbPath)) {
      // The template is a pre-migrated, empty SQLite file bundled as a pkg asset (see
      // server/scripts/build-windows.sh) — this is what lets the packaged binary
      // avoid ever needing Prisma's migration engine at runtime, only the query
      // engine.
      const templatePath = path.join(__dirname, "..", "prisma", "template.db");
      fs.writeFileSync(dbPath, fs.readFileSync(templatePath));
      console.log(`First run: created a new shop database at ${dbPath}`);
    } else {
      console.log(`Using existing database at ${dbPath}`);
    }

    const printJobsDir = path.join(portableDir, "print-jobs");
    fs.mkdirSync(printJobsDir, { recursive: true });

    ensurePersistedJwtSecret(portableDir);

    // Prisma's SQLite connector parses whatever follows "file:" loosely enough that a
    // Windows absolute path's backslashes and drive-letter colon (`file:C:\Users\...`)
    // can be misread as part of the URL scheme — forward slashes are the documented-
    // safe form (`file:C:/Users/...`) and work identically as a filesystem path.
    process.env.DATABASE_URL = `file:${dbPath.split(path.sep).join("/")}`;
    process.env.TEABOX_PRINT_JOBS_DIR = printJobsDir;
    packagedDbPath = dbPath;
  } else {
    // Standard Linux convention for a native package's mutable data — deliberately not
    // a dotfile in $HOME, so it behaves like a real installed application rather than a
    // script leaving droppings in the user's home directory.
    const dataDir = process.env.XDG_DATA_HOME
      ? path.join(process.env.XDG_DATA_HOME, "teabox")
      : path.join(os.homedir(), ".local", "share", "teabox");
    fs.mkdirSync(dataDir, { recursive: true });
    fs.mkdirSync(path.join(dataDir, "print-jobs"), { recursive: true });

    ensurePersistedJwtSecret(dataDir);

    const dbPath = path.join(dataDir, "teabox.db");
    if (!fs.existsSync(dbPath)) {
      const templatePath = path.join(__dirname, "..", "prisma", "template.db");
      fs.writeFileSync(dbPath, fs.readFileSync(templatePath));
      console.log(`First run: created a new shop database at ${dbPath}`);
    }

    process.env.DATABASE_URL = `file:${dbPath}`;
    process.env.TEABOX_PRINT_JOBS_DIR = path.join(dataDir, "print-jobs");
    packagedDbPath = dbPath;
  }
}
