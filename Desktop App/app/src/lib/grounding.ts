// NOT-5 safety net: flag generated values that cannot be found in the source (transcript or prior note).
// Deliberately simple and conservative: numbers (doses, counts, ages) and capitalized words in the middle of a sentence.

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9.%\s-]/g, " ");

function numbers(text: string): string[] {
  return text.match(/\b\d+(?:\.\d+)?\b/g) ?? [];
}

const NUMBER_WORDS: Record<string, string> = {
  zero: "0", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9", ten: "10",
};

/** Source text with spelled-out small numbers also written as digits, so "two weeks" supports "2 weeks". */
function withDigits(source: string): string {
  return source.replace(/\b(zero|one|two|three|four|five|six|seven|eight|nine|ten)\b/gi, (m) => `${m} ${NUMBER_WORDS[m.toLowerCase()]}`);
}

export function ungroundedTerms(output: string, source: string, allow: string[] = []): string[] {
  const src = norm(withDigits(source));
  const allowSet = new Set(allow.map((a) => a.toLowerCase()));
  const found = new Set<string>();
  for (const n of numbers(output)) if (!new RegExp(`(^|[^0-9.])${n.replace(".", "\\.")}([^0-9]|$)`).test(src)) found.add(n);
  // Capitalized words that are not at the start of a sentence (names of medications, places, people).
  for (const m of output.matchAll(/(?<![.!?]\s)(?<!^)(?<!\n)\b([A-Z][a-z]{3,})\b/g)) {
    const w = m[1];
    if (allowSet.has(w.toLowerCase())) continue;
    if (!src.includes(w.toLowerCase())) found.add(w);
  }
  return [...found];
}
