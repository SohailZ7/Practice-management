import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("who sees visits", () => {
  const route = readFileSync("src/app/api/desktop/v1/notes/visits/route.ts", "utf8");
  const get = route.slice(route.indexOf("export const GET"), route.indexOf("export const POST"));
  it("the recorder's visit list needs Notes view, like the web board, and is not filtered by user", () => {
    expect(get).toContain('level: "view"');
    expect(get).not.toContain('level: "edit"');
    expect(get).toContain("where: { visitDate: date }");
  });
  it("adding a visit still needs edit", () => {
    expect(route.slice(route.indexOf("export const POST"))).toContain('level: "edit"');
  });
});
