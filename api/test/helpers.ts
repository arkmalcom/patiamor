import { env, exports } from 'cloudflare:workers';
import { randomToken, sha256 } from '../src/auth/crypto';

// Helpers for API tests: real requests through the Worker, with users signed in by a real session row.

export const ORIGIN = 'http://example.test';

let n = 0;
/** A user with a live session; returns the cookie to send. */
export async function signIn(opts: { admin?: boolean; name?: string; owner?: boolean } = {}) {
  const id = `user-${++n}-${Date.now()}`;
  const email = `${id}@example.test`;
  // `owner`: approved to register shelters (admins don't need it).
  await env.DB.prepare("INSERT INTO users (id, email, name, is_admin, shelter_owner_at) VALUES (?, ?, ?, ?, ?)")
    .bind(id, email, opts.name ?? 'Prueba', opts.admin ? 1 : 0, opts.owner ? '2026-01-01T00:00:00Z' : null)
    .run();
  const token = randomToken();
  await env.DB.prepare("INSERT INTO sessions (id_hash, user_id, expires_at) VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '+1 day'))")
    .bind(await sha256(token), id)
    .run();
  return { id, email, cookie: `__Host-patiamor_session=${token}` };
}

/** Calls the API like the app does: JSON, same origin, optional session. */
export async function api(path: string, opts: { method?: string; body?: unknown; cookie?: string; origin?: string } = {}) {
  const headers: Record<string, string> = { Origin: opts.origin ?? ORIGIN };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.cookie) headers.Cookie = opts.cookie;
  const res = await exports.default.fetch(new Request(`${ORIGIN}${path}`, { method: opts.method ?? 'GET', headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) }));
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  return { status: res.status, json, headers: res.headers };
}

function b64(bytes: Uint8Array) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(s);
}

/** A minimal JPEG the server accepts: SOI, JFIF, a frame header with these dimensions, then random
 *  "image data" so every call hashes differently. `exif` adds an APP1 segment, as cameras do. */
export function fakeJpeg(width: number, height: number, opts: { exif?: boolean; extra?: number } = {}) {
  const parts = [
    [0xff, 0xd8],
    [0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00],
    ...(opts.exif ? [[0xff, 0xe1, 0x00, 0x08, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00]] : []),
    [0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01],
    [0xff, 0xda, 0x00, 0x02],
  ].flat();
  const noise = new Uint8Array(opts.extra ?? 64);
  crypto.getRandomValues(noise.subarray(0, 64));
  return b64(new Uint8Array([...parts, ...noise, 0xff, 0xd9]));
}

/** A minimal lossy WebP header with these dimensions. */
export function fakeWebp(width: number, height: number) {
  const vp8 = [0x56, 0x50, 0x38, 0x20, 0x0a, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x9d, 0x01, 0x2a, width & 0xff, width >> 8, height & 0xff, height >> 8, ...crypto.getRandomValues(new Uint8Array(4))];
  const size = 4 + vp8.length;
  return b64(new Uint8Array([0x52, 0x49, 0x46, 0x46, size & 0xff, (size >> 8) & 0xff, 0, 0, 0x57, 0x45, 0x42, 0x50, ...vp8]));
}

/** Uploads a valid photo (1600×1200 plus a 480×360 thumbnail) to a pet. */
export const addPhoto = (petId: string, cookie: string, body: Record<string, unknown> = {}) =>
  api(`/api/portal/pets/${petId}/photos`, { method: 'POST', cookie, body: { image: fakeJpeg(1600, 1200), thumb: fakeWebp(480, 360), ...body } });
