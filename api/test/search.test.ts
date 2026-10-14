import { describe, expect, it } from 'vitest';
import { fold, searchPets } from '../../web/src/search';

// The app's name search (web/src/search.ts): for someone who saw an animal elsewhere. It is plain
// functions on the animals the app already holds, so it is tested here with made-up ones.

const pet = (name: string, shelter: string | null, place: string, km: number) =>
  ({
    km,
    pet: {
      id: `${name}-${km}`,
      name,
      lister: shelter ? { type: 'shelter', id: shelter, name: shelter } : { type: 'private' },
      place: { name: place, municipality: 'Santo Domingo de Guzmán', province: 'Distrito Nacional' },
    },
  }) as never;

const animals = [
  pet('Pancho', 'Patitas de Gazcue', 'Gazcue', 20),
  pet('Pancho', 'Huellas del Este', 'Higüey', 150),
  pet('Panchito', 'Patitas de Gazcue', 'Gazcue', 20),
  pet('Pancha', 'Amigos de Boca Chica', 'Boca Chica', 30),
  pet('Luna Pancho', 'Hogar Sur', 'Barahona', 5),
  pet('Luna', 'Patitas de Gazcue', 'Gazcue', 20),
  pet('Canelo', null, 'Bávaro', 160),
];
const names = (list: { pet: { name: string; lister: { name?: string } } }[]) => list.map((x) => `${x.pet.name}@${x.pet.lister.name ?? 'particular'}`);
const find = (q: string) => {
  const r = searchPets(animals as { pet: never; km: number }[] as never[], q) as unknown as { matches: Parameters<typeof names>[0]; similar: Parameters<typeof names>[0] };
  return { matches: names(r.matches), similar: names(r.similar) };
};

describe('searching by name', () => {
  it('ignores capitals, accents and extra spaces', () => {
    expect(fold('  PanchÓ   Gazcue ')).toBe('pancho gazcue');
    expect(find('PANCHÓ').matches).toEqual(find('pancho').matches);
  });

  it('puts the animals named exactly so first (nearest first), then names containing it', () => {
    expect(find('pancho').matches).toEqual(['Pancho@Patitas de Gazcue', 'Pancho@Huellas del Este', 'Luna Pancho@Hogar Sur']);
  });

  it('offers close names when they might have spelled it differently', () => {
    expect(find('pancho').similar).toEqual(['Pancha@Amigos de Boca Chica', 'Panchito@Patitas de Gazcue']);
    expect(find('canela')).toEqual({ matches: [], similar: ['Canelo@particular'] });
    expect(find('zzzzz')).toEqual({ matches: [], similar: [] });
  });

  it('narrows with more words, and also finds by shelter or area', () => {
    expect(find('pancho gazcue').matches).toEqual(['Pancho@Patitas de Gazcue']);
    expect(find('higuey').matches).toEqual(['Pancho@Huellas del Este']);
    // All at the same distance, so no order is promised among them.
    expect(new Set(find('gazcue').matches)).toEqual(new Set(['Pancho@Patitas de Gazcue', 'Panchito@Patitas de Gazcue', 'Luna@Patitas de Gazcue']));
  });

  it('never matches private listers on the word "particular", and an empty search finds nothing', () => {
    expect(find('particular').matches).toEqual([]);
    expect(find('   ')).toEqual({ matches: [], similar: [] });
  });
});
