import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { execSync } from "node:child_process";

import { readFileSync } from "node:fs";
const version: string = JSON.parse(readFileSync("package.json", "utf8")).version;
let commit = "unknown";
try { commit = execSync("git rev-parse --short HEAD").toString().trim(); } catch { /* not a git checkout */ }

export default defineConfig({
  plugins: [react()],
  define: { __APP_COMMIT__: JSON.stringify(commit), __APP_VERSION__: JSON.stringify(version) },
  clearScreen: false,
  server: { port: 1420, strictPort: true, fs: { allow: ["../.."] } },
  test: { include: ["tests/**/*.test.ts"], environment: "node" },
});
