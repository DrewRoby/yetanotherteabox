import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // API_PROXY_TARGET lets a second dev stack run beside something already holding
      // :4000 (e.g. a running teabox.exe) — see .claude/launch.json's "-alt" entries.
      "/api": process.env.API_PROXY_TARGET ?? "http://localhost:4000",
    },
  },
});
