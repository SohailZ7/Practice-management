/** Splits a hardening SQL file into statements. Statements are separated by a line containing only "-- @@". */
export function parseSqlStatements(text: string): string[] {
  return text
    .split(/^-- @@\s*$/m)
    .map((chunk) =>
      chunk
        .split("\n")
        .filter((line) => !/^\s*--/.test(line))
        .join("\n")
        .trim(),
    )
    .filter(Boolean);
}
