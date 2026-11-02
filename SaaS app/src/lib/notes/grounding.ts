// NOT-5 safety net: flag generated values that cannot be found in the source (transcript or prior note).
// Deliberately simple and conservative: numbers (doses, counts, ages) and capitalized words in the middle of a sentence.

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9.%\s-]/g, " ");

function numbers(text: string): string[] {
  return text.match(/\b\d+(?:\.\d+)?\b/g) ?? [];
}

const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

/** "fifty" -> 50, "twenty five" -> 25, "one hundred" -> 100, "two hundred fifty" -> 250. Null when not a number phrase. */
export function wordsToNumber(words: string[]): number | null {
  let total = 0;
  let current = 0;
  let any = false;
  for (const raw of words) {
    const w = raw.toLowerCase();
    const one = ONES.indexOf(w);
    const ten = TENS.indexOf(w);
    if (one >= 0) { current += one; any = true; }
    else if (ten >= 2) { current += ten * 10; any = true; }
    else if (w === "hundred") { current = (current || 1) * 100; any = true; }
    else if (w === "and") continue;
    else return null;
  }
  return any ? total + current : null;
}

/** Source text with spelled-out numbers also written as digits, so "fifty milligrams" supports "50 mg". */
export function withDigits(source: string): string {
  const tokens = source.split(/(\s+)/);
  let out = "";
  let i = 0;
  while (i < tokens.length) {
    // Longest run of number words starting here (e.g. "two hundred fifty"), up to 5 words.
    let best: { n: number; end: number } | null = null;
    const words: string[] = [];
    for (let j = i, count = 0; j < tokens.length && count < 5; j += 2, count++) {
      const clean = tokens[j].replace(/[^a-zA-Z-]/g, "");
      const parts = clean.split("-");
      words.push(...parts);
      const n = wordsToNumber(words);
      if (n === null) break;
      best = { n, end: j };
    }
    if (best) {
      out += tokens.slice(i, best.end + 1).join("") + ` ${best.n}`;
      i = best.end + 1;
    } else {
      out += tokens[i];
      i += 1;
    }
  }
  return out;
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
