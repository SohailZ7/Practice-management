// Shared by the unify-* scripts. Counts and hashes only.
export const arg = (flag: string): string | undefined => { const i = process.argv.indexOf(flag); return i > 0 ? process.argv[i + 1] : undefined; };
export const has = (flag: string) => process.argv.includes(flag);
export const today = () => new Date().toISOString().slice(0, 10).replace(/-/g, "");
export function fail(msg: string): never { console.error(`FAILED: ${msg}`); process.exit(1); }
export function run(main: () => Promise<void>) {
  main().then(() => process.exit(0)).catch((e) => { console.error("unify failed:", e instanceof Error ? e.message : "error"); process.exit(1); });
}
