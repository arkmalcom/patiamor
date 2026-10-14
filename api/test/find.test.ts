import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { forgetCatalogVersion } from '../src/cache';
import { FIND_SQL } from '../src/pets';
import { api, signIn } from './helpers';

// Finding animals by name from the database, for when the app's own list doesn't have them: the whole
// country, but never adopted or withdrawn animals, and in a way that can't scan the table.

const find = (q: string) => api(`/api/pets/find?q=${encodeURIComponent(q)}`);
const names = (res: { json: { pets: { name: string }[] } }) => res.json.pets.map((p) => p.name).sort();

async function shelter(status: 'verified' | 'pending') {
  const owner = await signIn();
  const id = `sh-${crypto.randomUUID().slice(0, 8)}`;
  await env.DB.prepare("INSERT INTO shelters (id, slug, name, place_id, status, verified_at) VALUES (?, ?, 'Refugio', 'gazcue-distrito-nacional', ?, '2026-01-01T00:00:00Z')").bind(id, id, status).run();
  return { id, owner: owner.id };
}
async function pet(s: { id: string; owner: string }, name: string, status = 'available', birth = '2022-01-01') {
  await env.DB.prepare("INSERT INTO pets (id, listed_by, shelter_id, place_id, name, sex, size, energy, status, birth_date) VALUES (?, ?, ?, 'gazcue-distrito-nacional', ?, 'macho', 'mediano', 'media', ?, ?)")
    .bind(`${s.id}-${crypto.randomUUID().slice(0, 6)}`, s.owner, s.id, name, status, birth)
    .run();
}

beforeEach(() => forgetCatalogVersion());

describe('finding animals by name', () => {
  it('finds by the start of the name or of a later word, ignoring accents and capitals', async () => {
    const s = await shelter('verified');
    for (const n of ['Pancho', 'Panchó', 'Luna Pancho', 'Panchito', 'Canela']) await pet(s, n);
    expect(names(await find('pancho'))).toEqual(['Luna Pancho', 'Pancho', 'Panchó']);
    expect(names(await find('PANCHÓ'))).toEqual(['Luna Pancho', 'Pancho', 'Panchó']);
    expect(names(await find('panch'))).toEqual(['Luna Pancho', 'Panchito', 'Pancho', 'Panchó']);
    expect(names(await find('ancho'))).toEqual([]); // the start of a word, not the middle
  });

  it('includes animals en proceso, never adopted, withdrawn, draft, unverified or too young ones', async () => {
    const s = await shelter('verified');
    const pending = await shelter('pending');
    await pet(s, 'Zorro Disponible');
    await pet(s, 'Zorro Proceso', 'reserved');
    await pet(s, 'Zorro Adoptado', 'adopted');
    await pet(s, 'Zorro Retirado', 'withdrawn');
    await pet(s, 'Zorro Borrador', 'draft');
    await pet(pending, 'Zorro SinVerificar');
    await pet(s, 'Zorro Cachorro', 'available', new Date(Date.now() - 20 * 86_400_000).toISOString().slice(0, 10));
    const res = await find('zorro');
    expect(names(res)).toEqual(['Zorro Disponible', 'Zorro Proceso']);
    expect(res.json.pets.find((p: { name: string; status: string }) => p.name === 'Zorro Proceso').status).toBe('reserved');
  });

  it('takes up to three words of three letters or more, and refuses less', async () => {
    const s = await shelter('verified');
    await pet(s, 'Tigre');
    await pet(s, 'Leon');
    expect((await find('')).json.error).toBe('too_short');
    expect((await find('pa')).json.error).toBe('too_short');
    expect((await find('  . ')).json.error).toBe('too_short');
    // Every word is looked up on its own; the phone keeps what matches them all.
    expect(names(await find('tigre leon de'))).toEqual(['Leon', 'Tigre']);
  });

  it('returns what the app needs to show it, and at most thirty', async () => {
    const s = await shelter('verified');
    for (let i = 0; i < 35; i++) await pet(s, `Rocky ${i}`);
    const res = await find('rocky');
    expect(res.json.pets).toHaveLength(30);
    expect(res.json.pets[0]).toMatchObject({ species: 'perro', place: { id: 'gazcue-distrito-nacional' }, lister: { type: 'shelter' } });
  });

  it('reads only the animals it finds: the lookups use the name indexes, never a scan', async () => {
    const plan = await env.DB.prepare(`EXPLAIN QUERY PLAN ${FIND_SQL}`).bind('pancho', 'pancho\u{10FFFF}').all<{ detail: string }>();
    const steps = plan.results.map((r) => r.detail);
    expect(steps.some((d) => d.includes('pets_name_key'))).toBe(true);
    expect(steps.some((d) => d.includes('pets_name_rest'))).toBe(true);
    // The animals' own table is reached by key, not read through to find matches.
    expect(steps.filter((d) => /^SCAN (d|pets)\b/.test(d))).toEqual([]);
    expect(steps.filter((d) => d.includes('pets_status_place'))).toEqual([]);
  });
});
