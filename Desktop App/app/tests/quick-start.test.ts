import { describe, expect, it } from "vitest";
import { quickStartLabel } from "../src/App";
describe("quick start label", () => {
  it("shows time and initials, or the full name when the server sent it", () => {
    expect(quickStartLabel({ initials: "AB", apptTime: "9:00-11:30" })).toBe("9:00-11:30 AB");
    expect(quickStartLabel({ initials: "AB", fullName: "Ann Bee" })).toBe("Ann Bee");
  });
});
