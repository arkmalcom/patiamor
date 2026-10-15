// Money language in a listing (PAT-16, adopted 2026-10-12): selling, prices, deposits, breeding services,
// or a phone number in the text means a listing goes back to review before adopters see it. The fee has
// its own field (capped), so the text never needs to talk about money. Shared by the form (to warn before
// saving) and the API (which decides).

const fold = (s: string) => s.normalize('NFD').replace(/\p{Mn}/gu, '').toLowerCase();

/** What to look for, on accent-free lowercase text. */
const WORDS: RegExp[] = [
  /\b(?:se )?vend(?:o|e|emos|en|ido|ida)\b/g,
  /\bventas?\b/g,
  /\bprecios?\b/g,
  /\bnegociables?\b/g,
  /\bdepositos?\b/g,
  /\btransferencias?\b/g,
  /\breserv(?:ar|arlo|arla|arlos|arlas)\b/g,
  /\bmontas?\b/g, // breeding services
  /(?:\b(?:rd|us))?\$\s?[\d.,]*/g,
];
/** Something that may be a phone number; it counts when it has 10 or 11 digits (809-555-1234, +1 809…). */
const PHONE = /\+?\(?\d[\d\s.()-]{6,}\d/g;

/** The money language found in these texts (lowercase, without accents, deduplicated), or an empty list. */
export function moneyWords(...texts: (string | null | undefined)[]): string[] {
  const found = new Set<string>();
  for (const raw of texts) {
    if (!raw) continue;
    const text = fold(raw);
    for (const re of WORDS) for (const m of text.matchAll(re)) found.add(m[0].trim());
    for (const m of text.matchAll(PHONE)) {
      const digits = m[0].replace(/\D/g, '').length;
      if (digits === 10 || digits === 11) found.add(m[0].trim());
    }
  }
  return [...found].filter(Boolean);
}
