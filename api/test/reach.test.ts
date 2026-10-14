import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { forgetCatalogVersion } from '../src/cache';
import { api, signIn } from './helpers';

// The pet list has no distance limit (while shelters are few, animals can be far from a visitor), and
// comes nearest first.

async function petAt(placeId: string, name: string) {
  const owner = await signIn();
  const sid = `sh-${crypto.randomUUID().slice(0, 8)}`;
  await env.DB.prepare("INSERT INTO shelters (id, slug, name, place_id, status, verified_at) VALUES (?, ?, 'Refugio', ?, 'verified', '2026-01-01T00:00:00Z')").bind(sid, sid, placeId).run();
  await env.DB.prepare("INSERT INTO shelter_members (shelter_id, user_id, role) VALUES (?, ?, 'owner')").bind(sid, owner.id).run();
  const id = `${sid}-p`;
  await env.DB.prepare(
    "INSERT INTO pets (id, listed_by, shelter_id, place_id, name, sex, size, energy, status, birth_date, story, published_at) VALUES (?, ?, ?, ?, ?, 'hembra', 'mediano', 'media', 'available', '2022-01-01', 'Una historia de prueba bastante larga.', '2026-01-01T00:00:00Z')",
  )
    .bind(id, owner.id, sid, placeId, name)
    .run();
  return id;
}

beforeEach(() => forgetCatalogVersion());

describe('the pet list', () => {
  it('reaches animals far from the visitor, nearest first', async () => {
    const capital = await petAt('gazcue-distrito-nacional', 'Lejana');
    const coast = await petAt('puerto-plata-puerto-plata', 'Cercana');
    // A visitor in Monte Cristi (about 235 km from the capital, 100 km from Puerto Plata).
    const list = (await api('/api/pets?lat=19.85&lng=-71.65')).json.pets as { id: string }[];
    const ids = list.map((p) => p.id);
    expect(ids).toContain(capital);
    expect(ids).toContain(coast);
    expect(ids.indexOf(coast)).toBeLessThan(ids.indexOf(capital));
  });
});
