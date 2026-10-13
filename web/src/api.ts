// Thin client for the Patiamor Worker API (same origin in every environment).
import type { PetDetail, PetSummary, LatLng, Place } from './data';
import type { Answers, SavedItem } from './store';

export interface Me {
  id: string;
  email: string;
  name: string | null;
  isAdmin: boolean;
  shelters?: { id: string; name: string; role: 'owner' | 'maintainer' }[];
}

export class ApiError extends Error {
  readonly code: string;
  readonly data: Record<string, unknown>;
  constructor(code: string, data: Record<string, unknown>) {
    super(code);
    this.code = code;
    this.data = data;
  }
}

async function call<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new ApiError(String(data.error ?? `http_${res.status}`), data);
  return data as T;
}

export const api = {
  me: () => call<{ user: Me | null }>('/api/me').then((r) => r.user),
  setName: (name: string) => call<{ user: Me }>('/api/me', 'PATCH', { name }).then((r) => r.user),
  startEmail: (email: string, next: string) => call<{ ok: true }>('/api/auth/email/start', 'POST', { email, next }),
  verifyEmail: (email: string, code: string) => call<{ user: Me }>('/api/auth/email/verify', 'POST', { email, code }).then((r) => r.user),
  emailLink: (token: string) => call<{ user: Me }>('/api/auth/email/link', 'POST', { token }).then((r) => r.user),
  logout: () => call<{ ok: true }>('/api/auth/logout', 'POST', {}),
  googleUrl: (next: string) => `/api/auth/google/start?next=${encodeURIComponent(next)}`,

  // Coordinates are rounded to ~1 km before they leave the device.
  pets: (from: LatLng) => call<{ pets: PetSummary[] }>(`/api/pets?${point(from)}`).then((r) => r.pets),
  pet: (id: string, from?: LatLng | null) =>
    call<{ pet: PetDetail }>(`/api/pets/${encodeURIComponent(id)}${from ? `?${point(from)}` : ''}`).then((r) => r.pet),
  searchPlaces: (q: string) => call<{ places: Place[] }>(`/api/places?q=${encodeURIComponent(q)}`).then((r) => r.places),
  nearestPlace: (at: LatLng) => call<{ place: Place }>(`/api/places/nearest?${point(at)}`).then((r) => r.place),
  whereami: () => call<{ place: Place; source: 'ip' | 'default' }>('/api/whereami'),
  shortlist: () => call<{ items: SavedItem[] }>('/api/shortlist').then((r) => r.items),
  save: (petId: string, answers: Answers) => call<{ ok: true }>('/api/shortlist', 'POST', { petId, answers }),
  unsave: (petId: string) => call<{ ok: true }>(`/api/shortlist/${encodeURIComponent(petId)}`, 'DELETE', {}),
};

function point({ lat, lng }: LatLng) {
  return `lat=${lat.toFixed(2)}&lng=${lng.toFixed(2)}`;
}
