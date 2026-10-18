// Money is stored as whole cents so totals are exact.

export const MAX_CENTS = 99_999_999_999; // $999,999,999.99

/** Parses "$1,000.00", "1000", "12.5" or "-" / "" (nothing). Returns cents, or an error message. */
export function parseMoney(input: string): { cents: number } | { error: string } {
  const text = input.trim();
  if (text === "" || text === "-" || text === "—") return { cents: 0 };
  const cleaned = text.replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return { error: `"${input.trim()}" isn't an amount. Use numbers like 1,000.00.` };
  const [whole, frac = ""] = cleaned.split(".");
  const cents = Number(whole) * 100 + Number((frac + "00").slice(0, 2));
  if (!Number.isSafeInteger(cents) || cents > MAX_CENTS) return { error: "That amount is too large." };
  return { cents };
}

export function formatMoney(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100).toLocaleString("en-US");
  return `${sign}$${dollars}.${String(abs % 100).padStart(2, "0")}`;
}

/** Cents as a plain editable string ("1000.00"), or "" for zero. */
export function editableMoney(cents: number): string {
  return cents === 0 ? "" : formatMoney(cents);
}
