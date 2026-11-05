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

import { generateDocuments, fetchDocTypes, saveDocumentVersion, listDocuments, fetchDocument, noteErrorMessage, promoteFeedback, promoteErrorMessage, fetchTasks, createTask, updateTask, taskErrorMessage, fetchTranscript } from "../src/lib/api";
import { cleanCode, isSixDigits, interpret, retryWording } from "../src/lib/mfa";
import { searchVisits, searchErrorMessage, searchInputProblem } from "../src/lib/api";
import { startGenerate, generationFor } from "../src/lib/generate";
import { describeTranscript } from "../src/TranscriptDialog";
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
    vi.stubGlobal("fetch", () => Promise.resolve(new Response(JSON.stringify({ deleted: ["a", "b"], notFound: ["c"] }), { status: 200 })));
    expect(await deleteVisits(s, ["a", "b", "c"])).toEqual({ deleted: 2, notFound: 1 });
    vi.stubGlobal("fetch", (u: string, i?: RequestInit) => {
      seen.push(`${i?.method} ${u.split("/v1")[1]}`);
      return Promise.resolve(new Response(JSON.stringify({ deleted: 2, notFound: 1 }), { status: 200 }));
    });
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

describe("transcript status", () => {
  const base = { queued: false, hasTranscript: false };
  it("says what is true for each stage", () => {
    expect(describeTranscript({ ...base, phase: "recording" }).state).toBe("recording");
    expect(describeTranscript({ ...base, phase: "working" }).state).toBe("working");
    expect(describeTranscript({ ...base, phase: "idle", queued: true }).text).toMatch(/not uploaded yet/);
    expect(describeTranscript({ ...base, phase: "saved", queued: true }).text).toMatch(/Upload failed/);
    expect(describeTranscript({ ...base, phase: "sent" }).text).toMatch(/Uploaded to the cloud.*deleted/);
    expect(describeTranscript({ ...base, phase: "idle", hasTranscript: true }).state).toBe("uploaded");
    expect(describeTranscript({ ...base, phase: "failed", reason: "x" }).text).toMatch(/Failed: x/);
    expect(describeTranscript({ ...base, phase: "idle" }).state).toBe("none");
  });
});

describe("generate, notes, promote, tasks", () => {
  const s: Session = { baseUrl: "https://example.run.app", accessToken: "t" };
  const record = (body: unknown = {}, status = 200) => {
    const seen: string[] = [];
    vi.stubGlobal("fetch", (u: string, i?: RequestInit) => {
      seen.push(`${i?.method} ${u.split("/api/desktop/v1")[1]}`);
      return Promise.resolve(new Response(JSON.stringify(body), { status }));
    });
    return seen;
  };

  it("calls the right endpoints", async () => {
    const seen = record({ documentId: "d1", title: "T", content: "C", documents: [], tasks: [], promoted: true, promotedAt: "x", transcript: "t" });
    await fetchTranscript(s, "v1");
    await fetchDocTypes(s, "Follow Up");
    await generateDocuments(s, "v1", ["a", "b"]);
    await listDocuments(s, "v1");
    await fetchDocument(s, "v1", "d1");
    await fetchDocument(s, "v1", "d1", 2);
    await saveDocumentVersion(s, "v1", "d1", 2, { x: "y" });
    await promoteFeedback(s, "f1");
    await fetchTasks(s, "open");
    await createTask(s, "Call back", "2026-11-10");
    await updateTask(s, "t1", { status: "done" });
    expect(seen).toEqual([
      "GET /notes/visits/v1/transcript", "GET /notes/doc-types?appointmentType=Follow%20Up", "POST /notes/visits/v1/generate",
      "GET /notes/visits/v1/documents", "GET /notes/visits/v1/documents/d1", "GET /notes/visits/v1/documents/d1?version=2",
      "POST /notes/visits/v1/documents/d1/versions", "POST /feedback/f1/promote", "GET /tasks?status=open", "POST /tasks", "PATCH /tasks/t1",
    ]);
  });

  it("explains each error plainly", () => {
    const f = (status: number, code: string) => new ApiFailure(status, code);
    expect(noteErrorMessage(f(409, "no_transcript"))).toMatch(/Record it first/);
    expect(noteErrorMessage(f(409, "model_not_configured"))).toMatch(/not set up/);
    expect(noteErrorMessage(f(502, "generate_failed"))).toMatch(/failed/);
    expect(noteErrorMessage(f(404, "not_found"))).toMatch(/no longer exists/);
    expect(noteErrorMessage(f(409, "stale_version"))).toMatch(/newer version/);
    expect(noteErrorMessage(f(400, "no_doc_types"))).toMatch(/at least one/);
    expect(noteErrorMessage(f(400, "bad_doc_types"))).toMatch(/not available/);
    expect(noteErrorMessage(f(400, "no_changes"))).toMatch(/Nothing has changed/);
    expect(noteErrorMessage(f(400, "bad_values"))).toMatch(/not valid/);
    expect(promoteErrorMessage(f(409, "already_promoted"))).toMatch(/already/);
    expect(promoteErrorMessage(f(409, "is_test_item"))).toMatch(/test item/);
    expect(promoteErrorMessage(f(502, "promote_failed"))).toMatch(/did not accept/);
    expect(taskErrorMessage(f(400, "bad_title"))).toMatch(/title/);
  });

  it("generation runs outside the screen and records the result", async () => {
    const bodies: string[] = [];
    vi.stubGlobal("fetch", (_u: string, i?: RequestInit) => {
      bodies.push(String(i?.body));
      return Promise.resolve(new Response(JSON.stringify({ documents: [{ id: "d9", docType: "progress", title: "Progress note", latestVersion: 1 }], errors: [{ docType: "psych_eval", error: "generate_failed" }] }), { status: 200 }));
    });
    const p = startGenerate(s, "vx", ["progress", "psych_eval"]);
    expect(generationFor("vx")?.phase).toBe("running");
    await p;
    expect(generationFor("vx")).toMatchObject({ phase: "done", failedTypes: ["psych_eval"] });
    expect(bodies[0]).toBe('{"docTypes":["progress","psych_eval"]}');
    record({ error: "model_not_configured" }, 409);
    await startGenerate(s, "vy");
    expect(generationFor("vy")).toMatchObject({ phase: "failed" });
  });
});

describe("visit search", () => {
  const s: Session = { baseUrl: "https://example.run.app", accessToken: "t" };
  it("builds the query and explains errors", async () => {
    const seen: string[] = [];
    vi.stubGlobal("fetch", (u: string) => { seen.push(u.split("/api/desktop/v1")[1]); return Promise.resolve(new Response(JSON.stringify({ visits: [] }), { status: 200 })); });
    await searchVisits(s, { initials: "AB", date: "2026-11-05" });
    await searchVisits(s, { initials: "AB" });
    await searchVisits(s, { date: "2026-11-05" });
    expect(seen).toEqual(["/notes/visits/search?initials=AB&date=2026-11-05", "/notes/visits/search?initials=AB", "/notes/visits/search?date=2026-11-05"]);
    expect(searchErrorMessage(new ApiFailure(400, "bad_query"))).toMatch(/initials, a date, or both/);
    expect(searchErrorMessage(new ApiFailure(400, "bad_date"))).toMatch(/not valid/);
  });
  it("needs at least one input and plain initials", () => {
    expect(searchInputProblem("", "")).toMatch(/initials, a date, or both/);
    expect(searchInputProblem("A1", "")).toMatch(/letters only/);
    expect(searchInputProblem("ab", "")).toBe("");
    expect(searchInputProblem("A.B.", "")).toBe("");
    expect(searchInputProblem("ABCD", "")).toMatch(/up to 3/);
    expect(searchInputProblem("", "2026-11-05")).toBe("");
  });
});

describe("two-factor helpers", () => {
  it("cleans pasted codes", () => {
    expect(cleanCode("123 456")).toBe("123456");
    expect(cleanCode("12-34-56 78")).toBe("123456");
    expect(isSixDigits("123456")).toBe(true);
    expect(isSixDigits("12345")).toBe(false);
  });
  it("maps each server answer to a plain result", () => {
    expect(interpret(200, '{"recoveryCodes":["a"]}')).toMatchObject({ ok: true });
    expect(interpret(400, '{"error":"bad_code"}')).toMatchObject({ ok: false, kind: "error", message: expect.stringMatching(/not right/) });
    expect(interpret(400, '{"error":"bad_code"}', true)).toMatchObject({ message: expect.stringMatching(/recovery code/) });
    expect(interpret(401, '{"error":"invalid_or_expired_mfa_token"}')).toMatchObject({ kind: "expired" });
    expect(interpret(409, '{"error":"already_enrolled"}')).toMatchObject({ kind: "restart" });
    expect(interpret(409, '{"error":"not_enrolled"}')).toMatchObject({ kind: "restart" });
    expect(interpret(429, '{"error":"too_many_attempts","retryAfterSeconds":600}')).toMatchObject({ message: expect.stringMatching(/10 minutes/) });
    expect(interpret(429, "{}")).toMatchObject({ message: expect.stringMatching(/few minutes/) });
    expect(retryWording({ retryAt: new Date(Date.now() + 5 * 60000).toISOString() })).toMatch(/5 minutes|6 minutes/);
  });
});
