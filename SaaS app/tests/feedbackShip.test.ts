import { beforeEach, describe, expect, it, vi } from "vitest";

const rows: { id: string; status: string; shippedRelease: number | null }[] = [];
const events: { itemId: string; actorName: string; actorKind: string; fromValue: string; toValue: string }[] = [];
const audits: string[] = [];
vi.mock("../src/lib/db", () => ({
  db: {
    feedbackItem: {
      findMany: async ({ where }: { where: { status: string; shippedRelease: { lte: number } } }) =>
        rows.filter((r) => r.status === where.status && r.shippedRelease !== null && r.shippedRelease <= where.shippedRelease.lte).map((r) => ({ id: r.id })),
      updateMany: async ({ where, data }: { where: { id: string; status: string }; data: { status: string } }) => {
        const r = rows.find((x) => x.id === where.id && x.status === where.status);
        if (r) r.status = data.status;
        return { count: r ? 1 : 0 };
      },
    },
    feedbackEvent: { create: async ({ data }: { data: (typeof events)[number] }) => void events.push(data) },
    $transaction: async (fn: (tx: unknown) => unknown) => fn({
      feedbackItem: { updateMany: async (a: never) => (await import("../src/lib/db")).db.feedbackItem.updateMany(a) },
      feedbackEvent: { create: async (a: never) => (await import("../src/lib/db")).db.feedbackEvent.create(a) },
    }),
  },
}));
vi.mock("../src/lib/audit", () => ({ audit: async (_a: string, _b: string, d: string) => void audits.push(d) }));

import { releaseNumber, shipDueItems, shipLimit } from "../src/lib/feedback/autoShip";

const prod = { APP_ENV: "production", WEB_RELEASE: "Web 1.16" };
beforeEach(() => { rows.length = 0; events.length = 0; audits.length = 0; });

describe("release numbers", () => {
  it("parses the plain forms only", () => {
    expect(releaseNumber("Web 1.16")).toBe(16);
    expect(releaseNumber("1.16")).toBe(16);
    expect(releaseNumber(16)).toBe(16);
    expect(releaseNumber("16")).toBe(16);
    for (const bad of ["", "Web 2.1", "abc", 0, -3, "1.2.3", null, undefined, "Web 1.99999"]) expect(releaseNumber(bad)).toBeNull();
  });
  it("only production ever has a limit", () => {
    expect(shipLimit(prod)).toBe(16);
    expect(shipLimit({ ...prod, APP_ENV: "staging" })).toBeNull();
    expect(shipLimit({ WEB_RELEASE: "Web 1.16" })).toBeNull();
  });
});

describe("shipDueItems", () => {
  it("ships Approved items at or below the running release, as system, and nothing else", async () => {
    rows.push(
      { id: "a", status: "approved", shippedRelease: 15 },
      { id: "b", status: "approved", shippedRelease: 16 },
      { id: "c", status: "approved", shippedRelease: 17 },
      { id: "d", status: "approved", shippedRelease: null },
      { id: "e", status: "on_staging", shippedRelease: 10 },
      { id: "f", status: "needs_changes", shippedRelease: 10 },
    );
    expect(await shipDueItems(prod)).toBe(2);
    expect(rows.map((r) => `${r.id}:${r.status}`)).toEqual(["a:shipped", "b:shipped", "c:approved", "d:approved", "e:on_staging", "f:needs_changes"]);
    expect(events).toHaveLength(2);
    expect(events.every((e) => e.actorName === "system" && e.actorKind === "system" && e.fromValue === "approved" && e.toValue === "shipped")).toBe(true);
    expect(audits.every((d) => !/[A-Z][a-z]+ [A-Z][a-z]+/.test(d.replace("Web", "")))).toBe(true);
  });
  it("does nothing on staging, even when items are due", async () => {
    rows.push({ id: "a", status: "approved", shippedRelease: 1 });
    expect(await shipDueItems({ ...prod, APP_ENV: "staging" })).toBe(0);
    expect(rows[0].status).toBe("approved");
  });
  it("is repeatable and never moves an item twice", async () => {
    rows.push({ id: "a", status: "approved", shippedRelease: 3 });
    expect(await shipDueItems(prod)).toBe(1);
    expect(await shipDueItems(prod)).toBe(0);
    expect(events).toHaveLength(1);
  });
});
