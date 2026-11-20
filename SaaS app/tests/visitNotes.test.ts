import { describe, it, expect } from "vitest";
import { canWriteKind, canResolve, cleanNoteBody, isNoteKind, MAX_NOTE } from "@/lib/notes/visitNotes";

describe("visit notes rules", () => {
  it("restricts provider and admin notes by role", () => {
    expect(canWriteKind("STAFF", "general")).toBe(true);
    expect(canWriteKind("STAFF", "provider")).toBe(false);
    expect(canWriteKind("PROVIDER", "provider")).toBe(true);
    expect(canWriteKind("PROVIDER", "admin")).toBe(false);
    expect(canWriteKind("ADMIN", "admin")).toBe(true);
  });
  it("lets only the author or an admin resolve", () => {
    expect(canResolve("STAFF", "a@x", "a@x")).toBe(true);
    expect(canResolve("STAFF", "a@x", "b@x")).toBe(false);
    expect(canResolve("ADMIN", "a@x", "b@x")).toBe(true);
  });
  it("cleans and bounds the body and checks kinds", () => {
    expect(cleanNoteBody("  hi\r\nthere ")).toBe("hi\nthere");
    expect(cleanNoteBody(42)).toBe("");
    expect(cleanNoteBody("x".repeat(MAX_NOTE + 5))).toHaveLength(MAX_NOTE);
    expect(isNoteKind("admin")).toBe(true);
    expect(isNoteKind("other")).toBe(false);
  });
});
