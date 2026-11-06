// Mechanical additive-only gate for schema changes headed to production. Input: the SQL that `prisma migrate diff` would run
// to bring the target database to schema.prisma. Output: violations. No judgment: any statement that can lose or rewrite
// existing data, or that can fail on existing data, is a violation. A statement never has to be "probably fine".

export type Violation = { statement: string; rule: string };

/** Splits `prisma migrate diff --script` output into statements (each ends with ";" at a line end; comment lines dropped). */
export const splitDiffSql = (sql: string): string[] =>
  sql.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n").split(/;\s*(?:\n|$)/).map((x) => x.trim()).filter(Boolean);

const strip = (s: string) => s.replace(/--[^\n]*/g, "").replace(/\s+/g, " ").trim();
const tableOf = (s: string): string => /^ALTER TABLE (?:ONLY )?(?:IF EXISTS )?"?(?:public"?\.)?"?([A-Za-z0-9_]+)"?/i.exec(s)?.[1] ?? "";

export function gateSchemaSql(sql: string): Violation[] {
  const stmts = splitDiffSql(sql).map(strip).filter(Boolean);
  const created = new Set<string>();
  for (const s of stmts) {
    const m = /^CREATE TABLE (?:IF NOT EXISTS )?"?(?:public"?\.)?"?([A-Za-z0-9_]+)"?/i.exec(s);
    if (m) created.add(m[1]);
  }
  const out: Violation[] = [];
  const bad = (statement: string, rule: string) => out.push({ statement: statement.slice(0, 160), rule });
  for (const s of stmts) {
    const u = s.toUpperCase();
    if (/^(DELETE|UPDATE|TRUNCATE|INSERT)\b/.test(u)) bad(s, "data statement (DELETE/UPDATE/TRUNCATE/INSERT)");
    else if (/^DROP\b/.test(u) || /\bDROP (COLUMN|CONSTRAINT|TABLE|TYPE|DEFAULT)\b/.test(u)) bad(s, "DROP");
    else if (/\bRENAME\b/.test(u)) bad(s, "RENAME");
    else if (/^ALTER TYPE .* (RENAME|DROP)\b/.test(u)) bad(s, "enum value removed or renamed");
    else if (/\bALTER COLUMN\b.*\b(SET DATA TYPE|TYPE)\b/.test(u)) bad(s, "column type change");
    else if (/\bALTER COLUMN\b.*\bSET NOT NULL\b/.test(u)) bad(s, "SET NOT NULL on an existing column");
    else if (/^ALTER TABLE/.test(u) && /\bADD (COLUMN )?/.test(u)) {
      const t = tableOf(s);
      const isConstraint = /\bADD CONSTRAINT\b/.test(u);
      if (isConstraint) {
        if (/\bUNIQUE\b|\bPRIMARY KEY\b/.test(u) && !created.has(t)) bad(s, "unique/primary-key constraint added to an existing table");
      } else if (/\bNOT NULL\b/.test(u) && !/\bDEFAULT\b/.test(u) && !created.has(t)) bad(s, "NOT NULL column without DEFAULT added to an existing table");
    } else if (/^CREATE UNIQUE INDEX/.test(u)) {
      const t = /\bON (?:ONLY )?"?(?:public"?\.)?"?([A-Za-z0-9_]+)"?/i.exec(s)?.[1] ?? "";
      if (!created.has(t)) bad(s, "unique index added to an existing table");
    } else if (/^ALTER TYPE\b/.test(u) && !/\bADD VALUE\b/.test(u)) bad(s, "enum change other than ADD VALUE");
    else if (!/^(CREATE TABLE|CREATE INDEX|CREATE TYPE|ALTER TABLE|ALTER TYPE|CREATE EXTENSION|COMMENT ON)\b/.test(u)) bad(s, "statement type not on the additive allow-list");
  }
  return out;
}
