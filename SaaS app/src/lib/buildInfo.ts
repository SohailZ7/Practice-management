// What is running: a plain release number ("Web 1.6", from WEB-RELEASES.md or the WEB_RELEASE variable) and the environment.
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Highest "Web 1.N" in the release list text, or "". Pure, for tests. */
export function latestWebRelease(text: string): string {
  let best = -1;
  for (const m of text.matchAll(/^Web 1\.(\d{1,4})\b/gm)) best = Math.max(best, Number(m[1]));
  return best < 0 ? "" : `Web 1.${best}`;
}

export function environmentLabel(env: Record<string, string | undefined> = process.env): "STAGING" | "PRODUCTION" | "DEVELOPMENT" {
  return env.APP_ENV === "production" ? "PRODUCTION" : env.APP_ENV === "staging" ? "STAGING" : "DEVELOPMENT";
}

export function webRelease(env: Record<string, string | undefined> = process.env): string {
  if (env.WEB_RELEASE && /^Web 1\.\d{1,4}$/.test(env.WEB_RELEASE)) return env.WEB_RELEASE;
  try {
    return latestWebRelease(readFileSync(join(process.cwd(), "WEB-RELEASES.md"), "utf8")) || "Web (unnumbered)";
  } catch {
    return "Web (unnumbered)";
  }
}
