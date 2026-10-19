import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true, fs: { allow: ["../.."] } },
  test: { include: ["tests/**/*.test.ts"], environment: "node" },
});
