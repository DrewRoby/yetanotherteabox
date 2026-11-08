import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import pkg from "./package.json";

export default defineConfig({
  plugins: [react()],
  // Shown in the sidebar footer so a bug report can say which build it came from. Bump
  // server/, web/ and liberty-etl's package.json together (see RELEASE_NOTES.md).
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  server: {
    port: 5173,
    proxy: {
      // API_PROXY_TARGET lets a second dev stack run beside something already holding
      // :4000 (e.g. a running teabox.exe) — see .claude/launch.json's "-alt" entries.
      "/api": process.env.API_PROXY_TARGET ?? "http://localhost:4000",
    },
  },
});
