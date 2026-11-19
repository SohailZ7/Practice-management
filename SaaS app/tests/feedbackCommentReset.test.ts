import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// A comment typed for one move must not stay in the box and be re-posted with the next move.
// The move form is keyed by the item's state, history and comment counts so React remounts (and empties) it after every change.
describe("feedback move form resets after each change", () => {
  const src = readFileSync("src/app/feedback/page.tsx", "utf8");
  it("keys the move form on state, history and comment count", () => {
    const m = src.match(/<form action=\{moveFeedback\}[^>]*key=\{`([^`]+)`\}/);
    expect(m).not.toBeNull();
    for (const part of ["i.status", "events[i.id]", "comments[i.id]"]) expect(m![1]).toContain(part);
  });
});
