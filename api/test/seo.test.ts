import { env, exports } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { forgetCatalogVersion } from '../src/cache';
import { indexable } from '../src/seo';
import { ORIGIN, signIn } from './helpers';

// Search engines: robots.txt, the sitemap, and what a pet page tells crawlers.

async function get(path: string) {
  const res = await exports.default.fetch(new Request(`${ORIGIN}${path}`));
  return { status: res.status, type: res.headers.get('content-type'), text: await res.text(), headers: res.headers };
}

/** Runs `fn` as if the Worker were production at the test origin. */
async function asProduction<T>(fn: () => Promise<T>) {
  const before = env.ENVIRONMENT;
  (env as { ENVIRONMENT: string }).ENVIRONMENT = 'production';
  try {
    return await fn();
  } finally {
    (env as { ENVIRONMENT: string }).ENVIRONMENT = before;
  }
}

async function pet(name: string, over: { status?: string; birth?: string } = {}) {
  const owner = await signIn();
  const sid = `sh-${crypto.randomUUID().slice(0, 8)}`;
  await env.DB.prepare("INSERT INTO shelters (id, slug, name, place_id, status, verified_at) VALUES (?, ?, 'Patitas de Prueba', 'gazcue-distrito-nacional', 'verified', '2026-01-01T00:00:00Z')").bind(sid, sid).run();
  const id = `${sid}-p`;
  await env.DB.prepare(
    "INSERT INTO pets (id, listed_by, shelter_id, place_id, name, sex, size, energy, status, birth_date, story, published_at) VALUES (?, ?, ?, 'gazcue-distrito-nacional', ?, 'hembra', 'mediano', 'media', ?, ?, 'Una historia de prueba bastante larga.', '2026-01-01T00:00:00Z')",
  )
    .bind(id, owner.id, sid, name, over.status ?? 'available', over.birth ?? '2022-01-01')
    .run();
  return id;
}

beforeEach(() => forgetCatalogVersion());

describe('which addresses are for search', () => {
  it('only production, at its own address', () => {
    expect(indexable({ ENVIRONMENT: 'production', APP_ORIGIN: 'https://patiamor.com' }, 'https://patiamor.com')).toBe(true);
    expect(indexable({ ENVIRONMENT: 'production', APP_ORIGIN: 'https://patiamor.com' }, 'https://patiamor.x.workers.dev')).toBe(false);
    expect(indexable({ ENVIRONMENT: 'staging', APP_ORIGIN: 'https://patiamor-staging.x.workers.dev' }, 'https://patiamor-staging.x.workers.dev')).toBe(false);
    expect(indexable({ ENVIRONMENT: 'production', APP_ORIGIN: undefined }, 'https://patiamor.com')).toBe(false);
  });
});

describe('robots.txt', () => {
  it('keeps every crawler out of anything that is not production', async () => {
    const r = await get('/robots.txt');
    expect(r.status).toBe(200);
    expect(r.type).toContain('text/plain');
    expect(r.text).toBe('User-agent: *\nDisallow: /\n');
  });

  it('in production lets crawlers in, except the private pages, and points to the sitemap', async () => {
    const r = await asProduction(() => get('/robots.txt'));
    expect(r.text).toContain('User-agent: *');
    for (const path of ['/refugio', '/cuenta', '/lista', '/entrar', '/buscar']) expect(r.text).toContain(`Disallow: ${path}\n`);
    expect(r.text).not.toMatch(/Disallow: \/\n/);
    // The pages read their content from /api: blocking it would leave crawlers an empty page.
    expect(r.text).not.toContain('/api');
    expect(r.text).toContain(`Sitemap: ${ORIGIN}/sitemap.xml`);
  });
});

describe('sitemap.xml', () => {
  it('lists the front page, the legal texts and each animal open to requests, and no others', async () => {
    const open = await pet('Canela');
    const reserved = await pet('Rocky', { status: 'reserved' });
    const adopted = await pet('Luna', { status: 'adopted' });
    const tooYoung = await pet('Bebé', { birth: new Date().toISOString().slice(0, 10) });
    const r = await get('/sitemap.xml');
    expect(r.status).toBe(200);
    expect(r.type).toContain('application/xml');
    expect(r.text).toContain(`<loc>${ORIGIN}/</loc>`);
    expect(r.text).toContain(`<loc>${ORIGIN}/privacidad</loc>`);
    expect(r.text).toContain(`<loc>${ORIGIN}/terminos</loc>`);
    // The English texts are listed too, each pointing to its Spanish original and back.
    expect(r.text).toContain(`<loc>${ORIGIN}/en/privacy</loc>`);
    expect(r.text).toContain(`<xhtml:link rel="alternate" hreflang="es-DO" href="${ORIGIN}/privacidad"/><xhtml:link rel="alternate" hreflang="en" href="${ORIGIN}/en/privacy"/></url>`);
    expect(r.text).toContain(`<loc>${ORIGIN}/en/terms</loc>`);
    expect(r.text).toMatch(new RegExp(`<loc>${ORIGIN}/mascota/${open}</loc><lastmod>\\d{4}-\\d\\d-\\d\\dT[\\d:]+Z</lastmod>`));
    for (const id of [reserved, adopted, tooYoung]) expect(r.text).not.toContain(id);
    expect(r.text).not.toContain('/refugio');
  });
});

describe('what a pet page tells crawlers', () => {
  it('names its canonical address, and is kept out of results anywhere but production', async () => {
    const id = await pet('Canela');
    const { text } = await get(`/mascota/${id}`);
    expect(text).toContain(`<link rel="canonical" href="${ORIGIN}/mascota/${id}" />`);
    expect(text).toContain('<meta name="robots" content="noindex" />');
  });

  it('is open to results on the real site while the animal is available', async () => {
    const id = await pet('Canela');
    const { text } = await asProduction(() => get(`/mascota/${id}`));
    expect(text).toContain(`<link rel="canonical" href="${ORIGIN}/mascota/${id}" />`);
    expect(text).not.toContain('name="robots"');
  });

  it('is kept out of results once the animal has gone home', async () => {
    const id = await pet('Rocky', { status: 'adopted' });
    const { status, text } = await asProduction(() => get(`/mascota/${id}`));
    expect(status).toBe(200); // link previews (WhatsApp) still say it found a home
    expect(text).toContain('<meta name="robots" content="noindex" />');
  });
});

describe('the API', () => {
  it('can be read by crawlers (the pages need it) but is not listed; photos can be', async () => {
    const r = await get('/api/health');
    expect(r.headers.get('x-robots-tag')).toBe('noindex');
    const photo = await get('/api/photos/none');
    expect(photo.headers.get('x-robots-tag')).toBeNull();
  });
});
