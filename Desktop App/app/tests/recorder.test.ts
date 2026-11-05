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

import { normalizeTime, TIME_SLOTS } from "../src/lib/times";
import { fetchVisitOptions, deleteVisits, createVisit, updateVisit, deleteVisit, visitErrorMessage, fetchAuthConfig, cleanupFeedback, createFeedback, feedbackErrorMessage, fetchFeedback, updateFeedback, ApiFailure } from "../src/lib/api";

describe("the feedback client", () => {
  const capture = (body: unknown, status = 200) => {
    const seen: [string, RequestInit?][] = [];
    vi.stubGlobal("fetch", (u: string, i?: RequestInit) => (seen.push([u, i]), Promise.resolve(new Response(JSON.stringify(body), { status }))));
    return seen;
  };

  it("lists, creates, edits and cleans up with the right calls", async () => {
    let seen = capture({ items: [] });
    await fetchFeedback(session);
    expect(seen[0][0]).toBe("https://notes.example.test/api/desktop/v1/feedback?limit=100");
    seen = capture({ item: {} }, 201);
    await createFeedback(session, { kind: "BUG", title: "t", description: "d" });
    expect(seen[0][1]!.method).toBe("POST");
    expect(JSON.parse(String(seen[0][1]!.body))).toEqual({ kind: "BUG", title: "t", description: "d" });
    seen = capture({ item: {} });
    await updateFeedback(session, "a/b", { title: "new" });
    expect(seen[0][0]).toContain("/feedback/a%2Fb");
    expect(seen[0][1]!.method).toBe("PATCH");
    seen = capture({ title: "t", description: "d", possiblePhi: [] });
    await cleanupFeedback(session, "some words");
    expect(seen[0][0]).toContain("/feedback/cleanup");
    expect(JSON.parse(String(seen[0][1]!.body))).toEqual({ transcript: "some words" });
  });

  it("renews the token once after a 401 and retries", async () => {
    const tokens: string[] = [];
    vi.stubGlobal("fetch", (_u: string, i?: RequestInit) => {
      const t = (i!.headers as Record<string, string>).authorization;
      tokens.push(t);
      return Promise.resolve(new Response(JSON.stringify({ items: [] }), { status: t === "Bearer new" ? 200 : 401 }));
    });
    const s: Session = { ...session, refresh: async () => "new" };
    await fetchFeedback(s);
    expect(tokens).toEqual(["Bearer tok", "Bearer new"]);
  });

  it("explains the server's errors plainly", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(new Response(JSON.stringify({ error: "possible_phi" }), { status: 422 })));
    const e = await createFeedback(session, { kind: "BUG", title: "t", description: "d" }).catch((x) => x);
    expect(e).toBeInstanceOf(ApiFailure);
    expect(feedbackErrorMessage(e)).toMatch(/patient information/);
    expect(feedbackErrorMessage(new ApiFailure(503, "model_not_configured"))).toMatch(/not set up/);
    expect(feedbackErrorMessage(new ApiFailure(502, null))).toMatch(/failed/);
    expect(feedbackErrorMessage(new ApiFailure(413, null))).toMatch(/too long/);
    expect(feedbackErrorMessage(new ApiFailure(403, null))).toMatch(/your own/);
  });
});

describe("auth config", () => {
  it("reads googleSignIn, and a network failure is an error, not 'not set up'", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(new Response(JSON.stringify({ googleSignIn: true }), { status: 200 })));
    expect((await fetchAuthConfig("https://example.run.app")).googleSignIn).toBe(true);
    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("Failed to fetch")));
    await expect(fetchAuthConfig("https://example.run.app")).rejects.toThrow(/Could not reach/);
  });
});

describe("visit add / edit / delete", () => {
  it("uses POST, PATCH and DELETE on /notes/visits", async () => {
    const seen: [string, RequestInit | undefined][] = [];
    vi.stubGlobal("fetch", (u: string, i?: RequestInit) => (seen.push([u, i]), Promise.resolve(new Response(JSON.stringify({ ok: true, id: "v1" }), { status: 200 }))));
    const s: Session = { baseUrl: "https://example.run.app", accessToken: "t" };
    await createVisit(s, "2026-11-05", { patient: "Alpha Testcase", apptTime: "9:00" });
    await updateVisit(s, "v1", { apptTime: "10:00" });
    await deleteVisit(s, "v1");
    expect(seen.map(([u, i]) => `${i?.method} ${u.replace("https://example.run.app/api/desktop/v1", "")}`)).toEqual([
      "POST /notes/visits", "PATCH /notes/visits/v1", "DELETE /notes/visits/v1",
    ]);
    expect(JSON.parse(String(seen[0][1]?.body))).toMatchObject({ date: "2026-11-05", patient: "Alpha Testcase" });
    expect(visitErrorMessage(new ApiFailure(400, "bad_time"))).toMatch(/not valid/);
  });
});

describe("bulk delete", () => {
  it("uses the bulk endpoint, and falls back to one-by-one on 404", async () => {
    const s: Session = { baseUrl: "https://example.run.app", accessToken: "t" };
    const seen: string[] = [];
    vi.stubGlobal("fetch", (u: string, i?: RequestInit) => {
      seen.push(`${i?.method} ${u.split("/v1")[1]}`);
      return Promise.resolve(new Response(JSON.stringify({ deleted: 2, notFound: 1 }), { status: 200 }));
    });
    expect(await deleteVisits(s, ["a", "b", "c"])).toEqual({ deleted: 2, notFound: 1 });
    expect(seen).toEqual(["POST /notes/visits/bulk-delete"]);
    seen.length = 0;
    vi.stubGlobal("fetch", (u: string, i?: RequestInit) => {
      seen.push(`${i?.method} ${u.split("/v1")[1]}`);
      return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: u.includes("bulk") ? 404 : 200 }));
    });
    expect((await deleteVisits(s, ["a", "b"])).deleted).toBe(2);
    expect(seen).toEqual(["POST /notes/visits/bulk-delete", "DELETE /notes/visits/a", "DELETE /notes/visits/b"]);
  });
});

describe("times", () => {
  it("offers 15-minute slots from 6:00 AM to 8:00 PM", () => {
    expect(TIME_SLOTS[0]).toBe("6:00 AM");
    expect(TIME_SLOTS.at(-1)).toBe("8:00 PM");
    expect(TIME_SLOTS).toHaveLength(57);
  });
  it("accepts times and ranges, rejects everything else", () => {
    expect(normalizeTime("")).toBe("");
    expect(normalizeTime("9:00")).toBe("9:00");
    expect(normalizeTime("9 am")).toBe("9:00 AM");
    expect(normalizeTime("13:30")).toBe("1:30 PM");
    expect(normalizeTime("9:00 - 11:30")).toBe("9:00-11:30");
    for (const bad of ["abc", "25:00", "9:75", "9", "9:00-", "1-2-3", "noon"]) expect(normalizeTime(bad)).toBeNull();
  });
});

describe("visit options", () => {
  it("reads the lists, and returns null when the server has none yet", async () => {
    const s: Session = { baseUrl: "https://example.run.app", accessToken: "t" };
    vi.stubGlobal("fetch", () => Promise.resolve(new Response(JSON.stringify({ programs: ["KIOP-AM", ""], appointmentTypes: ["Follow-up"], providers: ["Dr. A"] }), { status: 200 })));
    expect(await fetchVisitOptions(s)).toEqual({ programs: ["KIOP-AM"], appointmentTypes: ["Follow-up"], providers: ["Dr. A"] });
    vi.stubGlobal("fetch", () => Promise.resolve(new Response("", { status: 404 })));
    expect(await fetchVisitOptions(s)).toBeNull();
  });
});
