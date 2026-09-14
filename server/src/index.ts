// Must be the very first import: it may rewrite DATABASE_URL for a packaged binary
// before any other module (transitively) constructs a PrismaClient. See bootstrap.ts.
import { isPackaged, packagedDbPath, packagedConfigPath } from "./bootstrap";

import express from "express";
import cors from "cors";
import helmet from "helmet";
import path from "path";
import fs from "fs";
import { exec } from "child_process";
import { setupRouter } from "./routes/setup.routes";
import { maybeAutoCompleteSetup } from "./services/setup.service";
import { authRouter } from "./routes/auth.routes";
import { accountsRouter } from "./routes/accounts.routes";
import { itemsRouter } from "./routes/items.routes";
import { posRouter } from "./routes/pos.routes";
import { reportsRouter } from "./routes/reports.routes";
import { settingsRouter } from "./routes/settings.routes";

const app = express();

// CSP off for now: the default policy needs to be tuned against the built web
// client's actual script/style sources before it's safe to turn on, and shipping it
// half-tuned would just break the app. The rest of helmet's defaults (X-Frame-
// Options, X-Content-Type-Options, etc.) are cheap wins with no such tradeoff.
app.use(helmet({ contentSecurityPolicy: false }));

// The packaged app serves the built web client from this same origin/port (see the
// static block below), so production has no cross-origin request to allow in the
// first place — CORS stays off there unless an operator explicitly opts in via
// CORS_ORIGIN (e.g. pointing a separate client at this API). Dev's two-process
// Vite+API setup is the one case that actually needs it.
const corsOrigin = process.env.CORS_ORIGIN;
if (corsOrigin) {
  app.use(cors({ origin: corsOrigin }));
} else if (!isPackaged) {
  app.use(cors({ origin: "http://localhost:5173" }));
}

app.use(express.json({ limit: "5mb" })); // generous limit for base64 intake photos in this stubbed setup

app.get("/api/health", (_req, res) => res.json({ ok: true }));

// Unauthenticated on purpose — see setup.routes.ts.
app.use("/api/setup", setupRouter);

app.use("/api/auth", authRouter);
app.use("/api/accounts", accountsRouter);
app.use("/api/items", itemsRouter);
app.use("/api/pos", posRouter);
app.use("/api/reports", reportsRouter);
app.use("/api/settings", settingsRouter);

// The packaged executable and any `npm run build`-then-serve deployment ship the
// built web client under server/public/ (see scripts/build-linux.sh). In normal dev,
// this directory doesn't exist and the two-process Vite+API setup is used instead —
// this block is a no-op then.
const publicDir = path.join(__dirname, "..", "public");
if (fs.existsSync(path.join(publicDir, "index.html"))) {
  app.use(express.static(publicDir));
  app.get(/^\/(?!api\/).*/, (_req, res) => {
    res.sendFile(path.join(publicDir, "index.html"));
  });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

const port = Number(process.env.PORT) || 4000;

// Node's default bind (no host given) is all interfaces — meaning a fresh install on
// a shop's network is reachable from any other device on that LAN over plain HTTP by
// default, with nothing prompting the operator to notice. This app has no TLS story
// of its own, so loopback-only is the safe default; reaching it from another device
// (a second register, say) requires explicitly opting in with HOST=0.0.0.0 (or a
// specific interface) in config.env/the environment, at which point it's on the
// operator to put a TLS-terminating reverse proxy in front of it.
const host = process.env.HOST || "127.0.0.1";

// Wrapped in an async start() so an env-driven auto-setup (see setup.service.ts's
// maybeAutoCompleteSetup) always finishes before the server accepts its first
// request — otherwise the SPA's own GET /setup/status could race it and still show
// the manual wizard on a fresh database.
async function start() {
  await maybeAutoCompleteSetup();

  const server = app.listen(port, host, () => {
    const url = `http://localhost:${port}`;
    console.log(`Teabox listening on ${url}`);
    if (host !== "127.0.0.1" && host !== "localhost") {
      console.warn(
        `\nWARNING: bound to ${host}, reachable from other devices on the network over plain HTTP.\n` +
          "Put a TLS-terminating reverse proxy in front of this if that's intentional.\n"
      );
    }

    // Windows test-deploy target only (see bootstrap.ts): the packaged Linux binary is
    // opened by install.sh instead, which already does its own health-check-then-open.
    if (isPackaged && process.platform === "win32") {
      console.log("");
      console.log("============================================================");
      console.log(` Teabox is running at ${url}`);
      if (packagedDbPath) console.log(` Database file: ${packagedDbPath}`);
      console.log(
        packagedConfigPath
          ? ` Config file:   ${packagedConfigPath}`
          : " Config file:   none found (using defaults — see config.env.example)"
      );
      console.log(" Keep teabox.exe, teabox.db, and config.env together if you move this folder.");
      console.log("============================================================");
      console.log("");
      exec(`start "" "${url}"`, (err) => {
        if (err) console.log(`Could not auto-open a browser; open ${url} manually.`);
      });
    }
  });

  // A specific, actionable message for the single most common startup failure — a
  // second copy of Teabox (e.g. a previous attempt that's still running) already
  // holding the port — before the generic uncaughtException handler in bootstrap.ts
  // logs it and holds the window open. Only relevant on the Windows target: on Linux,
  // install.sh's own health-check loop already surfaces "did it actually come up?".
  server.on("error", (err: NodeJS.ErrnoException) => {
    if (isPackaged && process.platform === "win32" && err.code === "EADDRINUSE") {
      console.error(`\nPort ${port} is already in use — is another copy of Teabox already running?`);
      console.error("Check Task Manager for a teabox.exe process and close it, then try again.");
      console.error("Or set PORT=<a free port, e.g. 4001> in config.env next to teabox.exe.\n");
    }
    throw err;
  });
}

start();
