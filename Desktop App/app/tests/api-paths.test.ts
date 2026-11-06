import { afterEach, describe, expect, it, vi } from "vitest";
import * as api from "../src/lib/api";

// Mirrors the Rust rule in google.rs check_api_path: every address the app builds must be inside the desktop API.
function pathAllowed(path: string): boolean {
  const [bare] = path.split("?");
  if (!bare.startsWith("/api/desktop/v1/")) return false;
  if (/[\u0000-\u001f\\]/.test(path)) return false;
  return !bare.replace(/%2e/gi, ".").split("/").some((seg) => seg === ".." || seg === ".");
}

describe("every request the app can build stays inside /api/desktop/v1", () => {
  const seen: string[] = [];
  afterEach(() => { vi.unstubAllGlobals(); seen.length = 0; });

  it("calls every exported API function that takes a session and checks the path it used", async () => {
    vi.stubGlobal("fetch", async (url: string) => {
      seen.push(new URL(url).pathname + new URL(url).search);
      return new Response("{}", { status: 200 });
    });
    const session = { baseUrl: "http://localhost:3000", accessToken: "t", refresh: async () => null } as unknown as api.Session;
    const id = "cmw4cnfbr000910xivu3gaj6f";
    for (const [name, fn] of Object.entries(api)) {
      if (typeof fn !== "function" || /^(visitErrorMessage|noteErrorMessage|taskErrorMessage|feedbackErrorMessage|searchErrorMessage|promoteErrorMessage|searchInputProblem|transport|fetchAuthConfig)$/.test(name)) continue;
      if (/^[A-Z]/.test(name)) continue; // classes
      try { await (fn as (...a: unknown[]) => unknown)(session, id, id, "2026-11-05", {}, {}); } catch { /* the stub reply may not fit; only the path matters */ }
      void name;
    }
    expect(seen.length).toBeGreaterThan(15);
    const bad = seen.filter((p) => !pathAllowed(p));
    expect(bad).toEqual([]);
  });

  it("the PDF download uses the desktop API route", async () => {
    let url = "";
    vi.stubGlobal("fetch", async (u: string) => { url = u; return new Response(new Blob(["%PDF"]), { status: 200 }); });
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => "blob:x", revokeObjectURL: () => {} }));
    const session = { baseUrl: "http://localhost:3000", accessToken: "t" } as api.Session;
    await api.downloadDocumentPdf(session, "v1", "d1", "x").catch(() => {});
    expect(new URL(url).pathname).toBe("/api/desktop/v1/notes/visits/v1/documents/d1/pdf");
  });
});
