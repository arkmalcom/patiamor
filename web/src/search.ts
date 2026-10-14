import type { PetSummary } from './data';

// Searching the animals by name (or shelter or area), for someone who saw one elsewhere: an Instagram post,
// a flyer. It runs on the list the app already holds (the nearest animals nationwide), so it costs no
// requests and answers as you type. Accents and capitals don't matter.

/** Lowercase, no accents, single spaces: "Panchó  Gazcue" → "pancho gazcue". */
export const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

/** Edit distance, kept small: names are short. */
function distance(a: string, b: string): number {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = row;
  }
  return prev[b.length];
}

/** How many letters may differ for a name to count as "parecido": none for short words, more for long ones. */
const slack = (len: number) => (len < 4 ? 0 : len < 6 ? 1 : 2);

type Item = { pet: PetSummary; km: number };

export interface Found<T extends Item> {
  /** Every word typed appears in the name, the shelter or the area; the ones named so come first. */
  matches: T[];
  /** Those among the matches whose own name has every word: what a search for an animal is after. */
  named: T[];
  /** No match, but a name that is close: "Pancha" for "Pancho", "Panchito" for "Pancho". */
  similar: T[];
}

export function searchPets<T extends Item>(all: T[], query: string): Found<T> {
  const words = fold(query).split(' ').filter(Boolean);
  if (!words.length) return { matches: [], named: [], similar: [] };
  const whole = words.join(' ');

  const matches: { item: T; rank: number }[] = [];
  const similar: { item: T; off: number }[] = [];
  for (const item of all) {
    const { pet } = item;
    const name = fold(pet.name);
    const elsewhere = fold([pet.lister.type === 'shelter' ? pet.lister.name : '', pet.place.name, pet.place.municipality, pet.place.province].join(' '));
    if (words.every((w) => name.includes(w) || elsewhere.includes(w))) {
      // Named exactly, named starting so, named containing it, and only then by shelter or area.
      const rank = name === whole ? 0 : name.startsWith(words[0]) && words.every((w) => name.includes(w)) ? 1 : words.every((w) => name.includes(w)) ? 2 : 3;
      matches.push({ item, rank });
      continue;
    }
    if (words.length === 1 && words[0].length >= 4) {
      const off = Math.min(...name.split(' ').map((n) => distance(n, words[0])));
      if (off > 0 && off <= slack(words[0].length)) similar.push({ item, off });
    }
  }
  const byDistance = (a: Item, b: Item) => a.km - b.km;
  const sorted = matches.sort((a, b) => a.rank - b.rank || byDistance(a.item, b.item));
  return {
    matches: sorted.map((m) => m.item),
    named: sorted.filter((m) => m.rank < 3).map((m) => m.item),
    similar: similar.sort((a, b) => a.off - b.off || byDistance(a.item, b.item)).map((m) => m.item),
  };
}
