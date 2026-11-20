import { afterEach, describe, expect, it, vi } from "vitest";
import { withTimeout } from "@/lib/loadGuard";

afterEach(() => vi.useRealTimers());

describe("withTimeout", () => {
  it("passes the value through", async () => {
    await expect(withTimeout(Promise.resolve(5), 1000)).resolves.toBe(5);
  });
  it("passes a rejection through", async () => {
    await expect(withTimeout(Promise.reject(new Error("db")), 1000)).rejects.toThrow("db");
  });
  it("rejects when the promise never settles", async () => {
    vi.useFakeTimers();
    const r = withTimeout(new Promise<number>(() => {}), 20000);
    const assertion = expect(r).rejects.toThrow("timeout");
    await vi.advanceTimersByTimeAsync(20001);
    await assertion;
  });
});
