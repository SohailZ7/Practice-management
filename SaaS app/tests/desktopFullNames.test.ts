import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

describe("desktop full names are opt-in per user", () => {
  it("schema defaults to false", () => {
    expect(read("prisma/schema.prisma")).toMatch(/showFullNames\s+Boolean\s+@default\(false\)/);
  });
  it("visits route adds fullName only when the user is allowed, and never logs it", () => {
    const src = read("src/app/api/desktop/v1/notes/visits/route.ts");
    expect(src).toMatch(/user\.showFullNames \? \{ fullName/);
    const audit = src.match(/audit\([^)]*\)/g) ?? [];
    expect(audit.join("")).not.toMatch(/fullName|firstName|lastName/);
  });
  it("only an admin can change it, via updateUser", () => {
    const src = read("src/app/admin/actions.ts");
    expect(src).toMatch(/showFullNames = form\.get\("showFullNames"\)/);
    expect(src).toMatch(/export async function updateUser\(form: FormData\) \{\n  const admin = await requireAdmin\(\)/);
  });
});
