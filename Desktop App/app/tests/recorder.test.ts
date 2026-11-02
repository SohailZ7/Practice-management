import { describe, expect, it, vi, afterEach } from "vitest";
import { fetchVisits, pushTranscript, type Session } from "../src/lib/api";
import { patientInitials } from "../src/lib/initials";

const session: Session = { baseUrl: "https://notes.example.test/", accessToken: "tok" };
const ok = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));

afterEach(() => vi.unstubAllGlobals());

describe("the practice API client", () => {
  it("asks for a day's visits with the token, and trims a trailing slash", async () => {
    const seen: [string, RequestInit?][] = [];
    vi.stubGlobal("fetch", (u: string, i?: RequestInit) => (seen.push([u, i]), ok({ date: "2026-11-01", visits: [] })));
    await fetchVisits(session, "2026-11-01");
    expect(seen[0][0]).toBe("https://notes.example.test/api/desktop/v1/notes/visits?date=2026-11-01");
    expect((seen[0][1]!.headers as Record<string, string>).authorization).toBe("Bearer tok");
  });

  it("sends a transcript as JSON", async () => {
    const seen: [string, RequestInit?][] = [];
    vi.stubGlobal("fetch", (u: string, i?: RequestInit) => (seen.push([u, i]), ok({ ok: true })));
    await pushTranscript(session, "v1", "the patient reports better sleep");
    expect(seen[0][0]).toContain("/notes/visits/v1/transcript");
    expect(seen[0][1]!.method).toBe("POST");
    expect(JSON.parse(String(seen[0][1]!.body))).toEqual({ transcript: "the patient reports better sleep" });
  });

  it("explains a signed-out or forbidden reply rather than showing a status code", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(new Response("", { status: 401 })));
    await expect(fetchVisits(session, "2026-11-01")).rejects.toThrow(/Sign in again/);
    vi.stubGlobal("fetch", () => Promise.resolve(new Response("", { status: 403 })));
    await expect(fetchVisits(session, "2026-11-01")).rejects.toThrow(/does not have access/);
  });

  it("escapes the visit id rather than pasting it into the path", async () => {
    const seen: string[] = [];
    vi.stubGlobal("fetch", (u: string) => (seen.push(u), ok({ ok: true })));
    await pushTranscript(session, "a/../b", "x");
    expect(seen[0]).toContain("a%2F..%2Fb");
  });
});

describe("initials", () => {
  it("is all the recorder ever shows of a patient", () => {
    expect(patientInitials("Testcase", "Alpha")).toBe("A.T.");
    expect(patientInitials("", "")).toBe("?");
  });
});
