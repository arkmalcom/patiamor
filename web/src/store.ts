import { ageGroup, dogs, shelterById, userLocation, type LatLng, type AgeGroup, type Companion, type Dog, type Energy, type Sex, type Size } from './data';
import type { Me } from './api';
import { bearing, distanceKm } from './geo';

export type Answer = 'si' | 'pensando';
export interface Answers {
  space: Answer;
  time: Answer;
  cost: Answer;
}
export interface SavedDog {
  dogId: string;
  savedAt: string;
  answers: Answers;
}

export interface Filters {
  size: Size[];
  age: AgeGroup[];
  sex: Sex[];
  energy: Energy[];
  goodWith: Companion[];
}

export interface State {
  radiusKm: number;
  filters: Filters;
  /** Mirrors the server session (from /api/me); never persisted locally. */
  signedIn: boolean;
  user: Me | null;
  list: SavedDog[];
  /** Dogs set aside this session. They come back next session. */
  skipped: string[];
}

export const MAX_SLOTS = 3;
export const RADIUS_MIN = 1;
export const RADIUS_MAX = 150;

const emptyFilters = (): Filters => ({ size: [], age: [], sex: [], energy: [], goodWith: [] });

function read<T>(storage: Storage | undefined, key: string, fallback: T): T {
  try {
    const raw = storage?.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

function write(storage: Storage | undefined, key: string, value: unknown) {
  try {
    storage?.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable: state stays in memory */
  }
}

const local = typeof localStorage === 'undefined' ? undefined : localStorage;
const session = typeof sessionStorage === 'undefined' ? undefined : sessionStorage;

const persisted = read(local, 'patiamor', { radiusKm: 25, filters: emptyFilters(), list: [] as SavedDog[] });
const sessionState = read(session, 'patiamor-session', { skipped: [] as string[] });

export const state: State = { ...persisted, filters: { ...emptyFilters(), ...persisted.filters }, ...sessionState, signedIn: false, user: null };

type Listener = () => void;
const listeners = new Set<Listener>();
export function subscribe(fn: Listener) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function update(mutator: (s: State) => void) {
  mutator(state);
  write(local, 'patiamor', { radiusKm: state.radiusKm, filters: state.filters, list: state.list });
  write(session, 'patiamor-session', { skipped: state.skipped });
  listeners.forEach((fn) => fn());
}

export interface Placed {
  dog: Dog;
  km: number;
  bearing: number;
}

export const here = { ...userLocation };

function place(): Placed[] {
  return dogs.map((dog) => {
    const shelter = shelterById.get(dog.shelterId)!;
    return { dog, km: distanceKm(here.point, shelter.location), bearing: bearing(here.point, shelter.location) };
  });
}

export let placed: Placed[] = place();
export let placedById = new Map(placed.map((p) => [p.dog.id, p]));

/** Rough bounding box of the Dominican Republic. */
export const inDR = (p: LatLng) => p.lat > 17.3 && p.lat < 20.1 && p.lng > -72.1 && p.lng < -68.2;

export function setLocation(point: LatLng, label: string, city: string) {
  Object.assign(here, { point, label, city });
  placed = place();
  placedById = new Map(placed.map((p) => [p.dog.id, p]));
  update(() => {});
}

export function matchesFilters(dog: Dog, f: Filters): boolean {
  if (f.size.length && !f.size.includes(dog.size)) return false;
  if (f.age.length && !f.age.includes(ageGroup(dog.ageMonths))) return false;
  if (f.sex.length && !f.sex.includes(dog.sex)) return false;
  if (f.energy.length && !f.energy.includes(dog.energy)) return false;
  if (f.goodWith.some((c) => dog.goodWith[c] !== true)) return false;
  return true;
}

export function inReach(radiusKm = state.radiusKm, filters = state.filters): Placed[] {
  return placed.filter((p) => p.km <= radiusKm && matchesFilters(p.dog, filters)).sort((a, b) => a.km - b.km);
}

/** The browse queue: in reach, not skipped this session, not already on the list. */
export function queue(): Placed[] {
  const listed = new Set(state.list.map((s) => s.dogId));
  return inReach().filter((p) => !state.skipped.includes(p.dog.id) && !listed.has(p.dog.id));
}

export function activeFilterCount(f = state.filters): number {
  return f.size.length + f.age.length + f.sex.length + f.energy.length + f.goodWith.length;
}

export function setUser(user: Me | null) {
  update((s) => ((s.user = user), (s.signedIn = !!user)));
}

/** A save interrupted by a Google redirect; completed when the user comes back signed in. */
const PENDING_KEY = 'patiamor-pending-save';
export function stashPendingSave(p: SavedDog) {
  try {
    session?.setItem(PENDING_KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}
export function takePendingSave(): SavedDog | null {
  try {
    const raw = session?.getItem(PENDING_KEY);
    session?.removeItem(PENDING_KEY);
    return raw ? (JSON.parse(raw) as SavedDog) : null;
  } catch {
    return null;
  }
}

export function isSaved(dogId: string) {
  return state.list.some((s) => s.dogId === dogId);
}

/** Nearest radius step that would bring at least one more dog into reach. */
export function nextRadius(): number | null {
  const beyond = placed.filter((p) => p.km > state.radiusKm && matchesFilters(p.dog, state.filters)).sort((a, b) => a.km - b.km)[0];
  return beyond ? Math.min(RADIUS_MAX, Math.ceil(beyond.km / 5) * 5) : null;
}
