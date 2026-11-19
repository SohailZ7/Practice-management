// Who may run the unification scripts, and where. Pure (takes env and argv) so it is tested.
//  - normal scripts: the existing guard() (APP_ENV must match the database; production needs --allow-prod and PROD_CONFIRM).
//  - the REHEARSAL script runs only on a scratch copy: never on the known production or staging hosts, never without an
//    explicit flag and a typed confirmation that names the host.
import { describeTarget, parseDbUrl, KNOWN_DB_HOSTS } from "../envGuard";

export const scratchConfirmPhrase = (host: string) => `SCRATCH-COPY-${host}`;

export function rehearsalVerdict(env: Record<string, string | undefined>, argv: readonly string[]): { ok: true; host: string } | { ok: false; reason: string } {
  const db = parseDbUrl(env.DATABASE_URL);
  if (!db) return { ok: false, reason: "DATABASE_URL is missing or not a valid URL" };
  const t = describeTarget(env);
  if (KNOWN_DB_HOSTS.production.includes(db.host) || t.kind === "production") return { ok: false, reason: "rehearsal never runs against the production database" };
  if (KNOWN_DB_HOSTS.staging.includes(db.host) || t.kind === "staging") return { ok: false, reason: "rehearsal never runs against the staging database (use a scratch copy or a local database)" };
  if (!argv.includes("--scratch-copy")) return { ok: false, reason: "pass --scratch-copy to confirm this database is a scratch copy" };
  if (env.SCRATCH_CONFIRM !== scratchConfirmPhrase(db.host)) return { ok: false, reason: `set SCRATCH_CONFIRM=${scratchConfirmPhrase(db.host)} to confirm` };
  return { ok: true, host: db.host };
}

/** Snapshot names: _snap_YYYYMMDD_*. The date is validated so it can safely be part of a table name. */
export function snapshotStamp(raw: string | undefined): string {
  if (!raw || !/^20\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])$/.test(raw)) throw new Error("snapshot date must be YYYYMMDD");
  return raw;
}
export const snapName = (stamp: string, what: "visit" | "scheduleentry" | "inbox" | "meta") => `_snap_${snapshotStamp(stamp)}_${what}`;
