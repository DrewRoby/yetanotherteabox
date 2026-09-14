// Must be the very first import: it may rewrite DATABASE_URL for a packaged binary
// before any other module (transitively) constructs a PrismaClient. See bootstrap.ts.
import { isPackaged, packagedDbPath, packagedConfigPath } from "./bootstrap";

import express from "express";
import cors from "cors";
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
app.use(cors({ origin: process.env.CORS_ORIGIN || "http://localhost:5173" }));
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

// Wrapped in an async start() so an env-driven auto-setup (see setup.service.ts's
// maybeAutoCompleteSetup) always finishes before the server accepts its first
// request — otherwise the SPA's own GET /setup/status could race it and still show
// the manual wizard on a fresh database.
async function start() {
  await maybeAutoCompleteSetup();

  const server = app.listen(port, () => {
    const url = `http://localhost:${port}`;
    console.log(`Teabox listening on ${url}`);

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
