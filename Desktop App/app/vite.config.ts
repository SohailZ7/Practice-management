import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { execSync } from "node:child_process";

let commit = "unknown";
try { commit = execSync("git rev-parse --short HEAD").toString().trim(); } catch { /* not a git checkout */ }

export default defineConfig({
  plugins: [react()],
  define: { __APP_COMMIT__: JSON.stringify(commit) },
  clearScreen: false,
  server: { port: 1420, strictPort: true, fs: { allow: ["../.."] } },
  test: { include: ["tests/**/*.test.ts"], environment: "node" },
});
