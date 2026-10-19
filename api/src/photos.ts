import { Hono, type Context } from 'hono';
import { forgetCatalogVersion } from './cache';
import type { AppContext } from './env';
import { roleIn } from './portal';

// Pet photos (PAT-9). Uploading is the one place strangers' bytes reach our storage, so it's guarded in
// layers, each cheap:
//  - only signed-in members of the animal's shelter, never while the shelter is suspended, and only from
//    the app's own origin (the JSON + Origin check in index.ts applies: photos arrive base64 in JSON);
//  - the request's size is checked before it's read, and each image's own bytes decide what it is: a
//    real JPEG or WebP, within size and dimension limits, with no EXIF/XMP (no GPS ever stored). The
//    Content-Type a client claims is ignored;
//  - keys are made here from a hash of the contents, never taken from the client;
//  - five photos per animal (a database trigger), daily upload budgets per person and overall, and a
//    storage ceiling below R2's free 10 GB;
//  - photos are served with a fixed image type, nosniff and a sandboxing CSP, so nothing stored can run
//    as a page on our origin.
// Resizing happens on the phone (web/src/ui/photos.ts): about 1600 px plus a 480 px thumbnail.

type C = Context<AppContext>;

const MAX_PHOTOS = 5;
const MAX_BODY = 1_000_000; // bytes of JSON: both images, base64, with room to spare
const FULL = { maxBytes: 600_000, maxEdge: 2048, minEdge: 400 };
const THUMB = { maxBytes: 80_000, maxEdge: 640, minEdge: 120 };
const USER_DAILY = 100; // a shelter listing 20 animals with 5 photos each, in one day
const GLOBAL_DAILY = 1000;
const STORAGE_MAX = 8 * 1024 ** 3; // stop well short of the free 10 GB
const KEY = /^pets\/[a-z0-9-]{1,64}\/[0-9a-f]{32}(-t)?\.(webp|jpg)$/;
const FOCUS = /^(\d{1,3})% (\d{1,3})%$/;

type ImageInfo = { type: 'image/jpeg' | 'image/webp'; width: number; height: number };

/** What an image really is, from its bytes; null when it isn't a clean JPEG or WebP we accept. */
export function inspectImage(b: Uint8Array): ImageInfo | null {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return inspectJpeg(b);
  const ascii = (at: number, s: string) => [...s].every((ch, i) => b[at + i] === ch.charCodeAt(0));
  if (b.length > 30 && ascii(0, 'RIFF') && ascii(8, 'WEBP')) return inspectWebp(b, ascii);
  return null;
}

function inspectJpeg(b: Uint8Array): ImageInfo | null {
  let i = 2;
  let size: { width: number; height: number } | null = null;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1];
    if (marker === 0xff) { i++; continue; } // fill byte
    if (marker === 0xd9 || marker === 0xda) break; // end of image, or start of the compressed data
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { i += 2; continue; }
    const len = (b[i + 2] << 8) | b[i + 3];
    if (len < 2 || i + 2 + len > b.length) return null;
    if (marker === 0xe1) return null; // APP1: EXIF or XMP, where cameras put GPS. The app never sends it.
    // Start-of-frame markers carry the dimensions (C4, C8 and CC are other tables).
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      size = { height: (b[i + 5] << 8) | b[i + 6], width: (b[i + 7] << 8) | b[i + 8] };
    }
    i += 2 + len;
  }
  return size ? { type: 'image/jpeg', ...size } : null;
}

function inspectWebp(b: Uint8Array, ascii: (at: number, s: string) => boolean): ImageInfo | null {
  const riffSize = b[4] | (b[5] << 8) | (b[6] << 16) | (b[7] << 24);
  if (riffSize + 8 !== b.length) return null;
  if (ascii(12, 'VP8 ')) {
    // Lossy: a keyframe start code, then 14-bit width and height.
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
    return { type: 'image/webp', width: (b[26] | (b[27] << 8)) & 0x3fff, height: (b[28] | (b[29] << 8)) & 0x3fff };
  }
  if (ascii(12, 'VP8L')) {
    if (b[20] !== 0x2f) return null;
    const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
    return { type: 'image/webp', width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (ascii(12, 'VP8X')) {
    const flags = b[20];
    if (flags & 0x0c) return null; // EXIF (0x08) or XMP (0x04) metadata
    if (flags & 0x02) return null; // animation
    return { type: 'image/webp', width: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), height: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) };
  }
  return null;
}

function decodeBase64(v: unknown, maxBytes: number): Uint8Array | null {
  if (typeof v !== 'string' || v.length > Math.ceil((maxBytes * 4) / 3) + 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(v)) return null;
  try {
    const bin = atob(v);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

/** Checks one image against its limits; returns its info or an error code. */
function check(bytes: Uint8Array | null, limits: typeof FULL): ImageInfo | string {
  if (!bytes || bytes.length > limits.maxBytes) return 'image_too_large';
  const info = inspectImage(bytes);
  if (!info) return 'invalid_image';
  const long = Math.max(info.width, info.height);
  if (long > limits.maxEdge || long < limits.minEdge || Math.min(info.width, info.height) < 1) return 'invalid_dimensions';
  return info;
}

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, '0')).join('');
const ext = (type: ImageInfo['type']) => (type === 'image/webp' ? 'webp' : 'jpg');
const today = () => new Date().toISOString().slice(0, 10);
export const validFocus = (v: unknown): v is string => {
  const m = typeof v === 'string' ? FOCUS.exec(v) : null;
  return !!m && Number(m[1]) <= 100 && Number(m[2]) <= 100;
};

/** The pet, if this person can change its photos. */
async function editablePet(c: C, petId: string) {
  const db = c.env.DB;
  const pet = await db
    .prepare('SELECT d.id, d.status, d.shelter_id, s.status AS shelter_status FROM pets d JOIN shelters s ON s.id = d.shelter_id WHERE d.id = ?')
    .bind(petId)
    .first<{ id: string; status: string; shelter_id: string; shelter_status: string }>();
  if (!pet || !(await roleIn(c, pet.shelter_id))) return { error: 'not_found' as const, status: 404 as const };
  if (pet.shelter_status === 'suspended') return { error: 'shelter_suspended' as const, status: 409 as const };
  return { pet };
}

export const photoRoutes = new Hono<AppContext>();

photoRoutes.use('*', async (c, next) => {
  if (!c.get('user')) return c.json({ error: 'unauthenticated' }, 401);
  await next();
});

// Add a photo: { image, thumb } as base64 (already resized on the phone), optional focus.
photoRoutes.post('/pets/:id/photos', async (c) => {
  // Refuse oversized bodies before reading them. Browsers always send a length for a JSON fetch.
  const length = Number(c.req.header('content-length'));
  if (!Number.isFinite(length) || length <= 0) return c.json({ error: 'length_required' }, 411);
  if (length > MAX_BODY) return c.json({ error: 'image_too_large' }, 413);

  const user = c.get('user')!;
  const found = await editablePet(c, c.req.param('id'));
  if ('error' in found) return c.json({ error: found.error }, found.status);
  const db = c.env.DB;

  const text = await c.req.text();
  if (text.length > MAX_BODY) return c.json({ error: 'image_too_large' }, 413);
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return c.json({ error: 'invalid_image' }, 400);
  }
  const fullBytes = decodeBase64(body.image, FULL.maxBytes);
  const thumbBytes = decodeBase64(body.thumb, THUMB.maxBytes);
  const full = check(fullBytes, FULL);
  if (typeof full === 'string') return c.json({ error: full }, 400);
  const thumb = check(thumbBytes, THUMB);
  if (typeof thumb === 'string') return c.json({ error: `thumb_${thumb}` }, 400);
  const focus = body.focus === undefined ? '50% 40%' : body.focus;
  if (!validFocus(focus)) return c.json({ error: 'invalid_focus' }, 400);

  // Budgets, cheapest first: this animal's count, this person's day, everyone's day, total storage.
  const [count, mine, all, storage] = await db.batch<{ n: number }>([
    db.prepare('SELECT count(*) AS n FROM pet_photos WHERE pet_id = ?').bind(found.pet.id),
    db.prepare('SELECT coalesce(sum(n), 0) AS n FROM photo_quota WHERE day = ? AND user_id = ?').bind(today(), user.id),
    db.prepare('SELECT coalesce(sum(n), 0) AS n FROM photo_quota WHERE day = ?').bind(today()),
    db.prepare('SELECT bytes AS n FROM photo_storage WHERE id = 1'),
  ]);
  if ((count.results[0]?.n ?? 0) >= MAX_PHOTOS) return c.json({ error: 'photos_full' }, 409);
  if ((mine.results[0]?.n ?? 0) >= USER_DAILY) return c.json({ error: 'upload_limit' }, 429);
  if ((all.results[0]?.n ?? 0) >= GLOBAL_DAILY) {
    console.error(`photo uploads hit the global daily limit of ${GLOBAL_DAILY}`);
    return c.json({ error: 'upload_limit' }, 429);
  }
  const size = fullBytes!.length + thumbBytes!.length;
  if ((storage.results[0]?.n ?? 0) + size > STORAGE_MAX) {
    console.error('photo storage is at its ceiling; uploads are refused until old photos are cleaned up');
    return c.json({ error: 'storage_full' }, 507);
  }
  // Counted before writing, so failed or abandoned uploads still use up the budget.
  await db
    .prepare('INSERT INTO photo_quota (day, user_id, n) VALUES (?, ?, 1) ON CONFLICT (day, user_id) DO UPDATE SET n = n + 1')
    .bind(today(), user.id)
    .run();

  const hash = hex(await crypto.subtle.digest('SHA-256', fullBytes!)).slice(0, 32);
  const key = `pets/${found.pet.id}/${hash}.${ext(full.type)}`;
  const thumbKey = `pets/${found.pet.id}/${hash}-t.${ext(thumb.type)}`;
  const dupe = await db.prepare('SELECT 1 FROM pet_photos WHERE r2_key = ?').bind(key).first();
  if (dupe) return c.json({ error: 'duplicate_photo' }, 409);

  await Promise.all([
    c.env.PHOTOS.put(key, fullBytes!, { httpMetadata: { contentType: full.type } }),
    c.env.PHOTOS.put(thumbKey, thumbBytes!, { httpMetadata: { contentType: thumb.type } }),
  ]);
  const id = crypto.randomUUID();
  try {
    await db
      .prepare(
        `INSERT INTO pet_photos (id, pet_id, r2_key, thumb_key, content_type, bytes, uploaded_by, position, focus, width, height)
         VALUES (?, ?, ?, ?, ?, ?, ?, (SELECT coalesce(max(position), -1) + 1 FROM pet_photos WHERE pet_id = ?), ?, ?, ?)`,
      )
      .bind(id, found.pet.id, key, thumbKey, full.type, size, user.id, found.pet.id, focus, full.width, full.height)
      .run();
  } catch (err) {
    // Lost a race to the fifth photo (the trigger) or to the same photo: don't leave the objects behind.
    await c.env.PHOTOS.delete([key, thumbKey]);
    return c.json({ error: String(err).includes('photos_full') ? 'photos_full' : 'duplicate_photo' }, 409);
  }
  forgetCatalogVersion();
  return c.json({ photo: { id, url: `/api/photos/${encodeURIComponent(key)}`, thumb: `/api/photos/${encodeURIComponent(thumbKey)}`, focus, width: full.width, height: full.height } }, 201);
});

// Order and framing in one go: { photos: [{ id, focus }] }, every current photo exactly once; the first is the cover.
photoRoutes.put('/pets/:id/photos', async (c) => {
  const found = await editablePet(c, c.req.param('id'));
  if ('error' in found) return c.json({ error: found.error }, found.status);
  const body = await c.req.json<{ photos?: { id?: unknown; focus?: unknown }[] }>().catch(() => ({}) as { photos?: undefined });
  const wanted = Array.isArray(body.photos) ? body.photos : null;
  const db = c.env.DB;
  const { results: current } = await db.prepare('SELECT id FROM pet_photos WHERE pet_id = ?').bind(found.pet.id).all<{ id: string }>();
  const ids = new Set(current.map((p) => p.id));
  if (!wanted || wanted.length !== ids.size || new Set(wanted.map((p) => p.id)).size !== ids.size || !wanted.every((p) => ids.has(p.id as string) && validFocus(p.focus)))
    return c.json({ error: 'invalid_order' }, 400);
  await db.batch([
    // Positions are unique per pet, so move them all out of the way first.
    db.prepare('UPDATE pet_photos SET position = -1 - position WHERE pet_id = ?').bind(found.pet.id),
    ...wanted.map((p, i) => db.prepare('UPDATE pet_photos SET position = ?, focus = ? WHERE id = ? AND pet_id = ?').bind(i, p.focus, p.id, found.pet.id)),
  ]);
  forgetCatalogVersion();
  return c.json({ ok: true });
});

photoRoutes.delete('/pets/:id/photos/:photoId', async (c) => {
  const found = await editablePet(c, c.req.param('id'));
  if ('error' in found) return c.json({ error: found.error }, found.status);
  const db = c.env.DB;
  const photo = await db.prepare('SELECT id, r2_key, thumb_key FROM pet_photos WHERE id = ? AND pet_id = ?').bind(c.req.param('photoId'), found.pet.id).first<{ id: string; r2_key: string; thumb_key: string | null }>();
  if (!photo) return c.json({ error: 'not_found' }, 404);
  // Adopters can see this animal: it keeps at least one photo.
  if (['available', 'reserved'].includes(found.pet.status)) {
    const n = await db.prepare('SELECT count(*) AS n FROM pet_photos WHERE pet_id = ?').bind(found.pet.id).first<{ n: number }>();
    if ((n?.n ?? 0) <= 1) return c.json({ error: 'last_photo' }, 409);
  }
  await db.prepare('DELETE FROM pet_photos WHERE id = ?').bind(photo.id).run();
  forgetCatalogVersion();
  if (photo.r2_key.startsWith('pets/'))
    await c.env.PHOTOS.delete([photo.r2_key, ...(photo.thumb_key ? [photo.thumb_key] : [])]).catch((err) => console.error('photo delete from R2 failed', photo.r2_key, err));
  return c.json({ ok: true });
});

/** GET /api/photos/:key. Keys are content hashes, so a copy never goes stale: cached for a year. */
export async function servePhoto(c: C) {
  const key = c.req.param('key') ?? '';
  if (!KEY.test(key)) return c.json({ error: 'not_found' }, 404);
  const cache = (caches as unknown as { default: Cache }).default; // a no-op on workers.dev (staging)
  const hit = await cache.match(c.req.url);
  if (hit) return new Response(hit.body, hit); // a cached response's headers are read-only; the /api middleware adds its own
  const object = await c.env.PHOTOS.get(key);
  if (!object) {
    c.header('Cache-Control', 'public, max-age=300');
    return c.json({ error: 'not_found' }, 404);
  }
  const res = new Response(object.body, {
    headers: {
      'Content-Type': key.endsWith('.webp') ? 'image/webp' : 'image/jpeg', // from the key we made, not from upload metadata
      'Cache-Control': 'public, max-age=31536000, immutable',
      ETag: object.httpEtag,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    },
  });
  c.executionCtx.waitUntil(cache.put(c.req.url, res.clone()));
  return res;
}
