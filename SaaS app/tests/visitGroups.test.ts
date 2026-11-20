import { describe, expect, it } from "vitest";
import { groupVisits } from "../src/lib/notes/groups";

const v = (id: string, program: string, apptTime: string) => ({ id, program, apptTime });

describe("groupVisits", () => {
  it("gathers visits that share a program and time into one coloured group, keeping the day's order", () => {
    const g = groupVisits([v("1", "KIOP-AM", "9:00-11:30"), v("2", "", "10:00 AM"), v("3", "kiop-am", "9:00 - 11:30"), v("4", "BPHP-AM", "9:00-12:30")]);
    expect(g.map((x) => x.rows.map((r) => r.id))).toEqual([["1", "3"], ["2"], ["4"]]);
    expect(g[0].key).not.toBeNull();
    expect(g[0].color).toBeTruthy();
    expect(g[1].key).toBeNull();
    expect(g[2].key).toBeNull();
  });
  it("gives each program its own colour", () => {
    const g = groupVisits([v("1", "A", "9:00"), v("2", "A", "9:00"), v("3", "B", "9:00"), v("4", "B", "9:00")]);
    expect(g[0].color).not.toBe(g[1].color);
  });
});
