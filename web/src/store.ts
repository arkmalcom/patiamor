import { api, type Me } from './api';
import { ageGroup, ageMonths, companionKey, type SpeciesFilter, type AgeGroup, type Companion, type PetDetail, type PetSummary, type Energy, type Place, type Sex, type Size } from './data';
import { bearing, distanceKm } from './geo';

export type Answer = 'si' | 'pensando';
export interface Answers {
  space: Answer;
  time: Answer;
  cost: Answer;
}
/** A pet in "Mi lista", as returned by the server. */
export interface SavedItem {
  pet: PetSummary;
  answers: Answers;
  savedAt: string;
}

export interface Filters {
  size: Size[];
  age: AgeGroup[];
  sex: Sex[];
  energy: Energy[];
  goodWith: Companion[];
}

export type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface State {
  /** Dogs, cats, or both. Applies everywhere: deck, radar counts, empty states. */
  species: SpeciesFilter;
  radiusKm: number;
  filters: Filters;
  /** The area distances are measured from: a place centroid, never a precise position. */
  location: Place | null;
  pets: PetSummary[];
  petsStatus: LoadStatus;
  /** Mirrors the server session (from /api/me); never persisted locally. */
  signedIn: boolean;
  user: Me | null;
  saved: SavedItem[];
  /** Pets set aside this session. They come back next session. */
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

const persisted = read(local, 'patiamor', { species: 'todos' as SpeciesFilter, radiusKm: 25, filters: emptyFilters(), location: null as Place | null });
const sessionState = read(session, 'patiamor-session', { skipped: [] as string[] });

export const state: State = {
  species: persisted.species,
  radiusKm: persisted.radiusKm,
  filters: { ...emptyFilters(), ...persisted.filters },
  location: persisted.location,
  pets: [],
  petsStatus: 'idle',
  signedIn: false,
  user: null,
  saved: [],
  skipped: sessionState.skipped,
};

type Listener = () => void;
const listeners = new Set<Listener>();
export function subscribe(fn: Listener) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function update(mutator: (s: State) => void) {
  mutator(state);
  write(local, 'patiamor', { species: state.species, radiusKm: state.radiusKm, filters: state.filters, location: state.location });
  write(session, 'patiamor-session', { skipped: state.skipped });
  recompute();
  listeners.forEach((fn) => fn());
}

// ---------- Pets placed relative to the chosen area ----------

export interface Placed {
  pet: PetSummary;
  km: number;
  bearing: number;
}

const place = (pet: PetSummary): Placed => {
  const from = state.location ?? pet.place;
  return { pet, km: distanceKm(from, pet.place), bearing: bearing(from, pet.place) };
};

export let placed: Placed[] = [];
export let placedById = new Map<string, Placed>();
/** Every pet seen in this session (lists, profiles, Mi lista), for screens that need one by id. */
export const petCache = new Map<string, PetSummary | PetDetail>();

function recompute() {
  placed = state.pets.map(place);
  placedById = new Map(placed.map((p) => [p.pet.id, p]));
}

export function placePet(pet: PetSummary): Placed {
  return placedById.get(pet.id) ?? place(pet);
}

export function cachePets(pets: PetSummary[]) {
  for (const d of pets) if (!(petCache.get(d.id) as PetDetail | undefined)?.story) petCache.set(d.id, d);
}

let petsRequest = 0;
export async function loadPets() {
  if (!state.location) return;
  const id = ++petsRequest;
  update((s) => (s.petsStatus = 'loading'));
  try {
    const pets = await api.pets(state.location);
    if (id !== petsRequest) return; // a newer location won the race
    cachePets(pets);
    update((s) => ((s.pets = pets), (s.petsStatus = 'ready')));
  } catch {
    if (id === petsRequest) update((s) => (s.petsStatus = 'error'));
  }
}

export async function setLocation(place: Place) {
  update((s) => (s.location = place));
  await loadPets();
}

export function matchesFilters(pet: PetSummary, f: Filters, species: SpeciesFilter = state.species): boolean {
  if (species !== 'todos' && pet.species !== species) return false;
  if (f.size.length && !f.size.includes(pet.size)) return false;
  if (f.age.length) {
    const g = ageGroup(ageMonths(pet.birthDate));
    if (!g || !f.age.includes(g)) return false;
  }
  if (f.sex.length && !f.sex.includes(pet.sex)) return false;
  if (f.energy.length && !f.energy.includes(pet.energy)) return false;
  if (f.goodWith.some((c) => pet.goodWith[companionKey[c]] !== true)) return false;
  return true;
}

export function inReach(radiusKm = state.radiusKm, filters = state.filters): Placed[] {
  return placed.filter((p) => p.km <= radiusKm && matchesFilters(p.pet, filters)).sort((a, b) => a.km - b.km);
}

/** The browse queue: in reach, not skipped this session, not already on the list. */
export function queue(): Placed[] {
  const listed = new Set(state.saved.map((s) => s.pet.id));
  return inReach().filter((p) => !state.skipped.includes(p.pet.id) && !listed.has(p.pet.id));
}

/** In-radius counts per species (ignoring the species switch), shown on the switch itself. */
export function speciesCounts(radiusKm = state.radiusKm, filters = state.filters): Record<SpeciesFilter, number> {
  const c = { perro: 0, gato: 0, todos: 0 };
  for (const p of placed) if (p.km <= radiusKm && matchesFilters(p.pet, filters, 'todos')) c[p.pet.species]++, c.todos++;
  return c;
}

export function activeFilterCount(f = state.filters): number {
  return f.size.length + f.age.length + f.sex.length + f.energy.length + f.goodWith.length;
}

/** Nearest radius step that would bring at least one more pet into reach. */
export function nextRadius(): number | null {
  const beyond = placed.filter((p) => p.km > state.radiusKm && matchesFilters(p.pet, state.filters)).sort((a, b) => a.km - b.km)[0];
  return beyond ? Math.min(RADIUS_MAX, Math.ceil(beyond.km / 5) * 5) : null;
}

// ---------- Account and "Mi lista" ----------

export function setUser(user: Me | null) {
  update((s) => {
    s.user = user;
    s.signedIn = !!user;
    if (!user) s.saved = [];
  });
  if (user) void loadSaved().catch(() => {});
}

export async function loadSaved() {
  const items = await api.shortlist();
  cachePets(items.map((i) => i.pet));
  update((s) => (s.saved = items));
}

export async function savePet(petId: string, answers: Answers) {
  await api.save(petId, answers);
  await loadSaved();
}

export async function removeSaved(petId: string) {
  await api.unsave(petId);
  await loadSaved();
}

export function isSaved(petId: string) {
  return state.saved.some((s) => s.pet.id === petId);
}

/** A save interrupted by a sign-in redirect; completed when the user comes back signed in. */
export interface PendingSave {
  petId: string;
  answers: Answers;
}
const PENDING_KEY = 'patiamor-pending-save';
export function stashPendingSave(p: PendingSave) {
  try {
    session?.setItem(PENDING_KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}
export function takePendingSave(): PendingSave | null {
  try {
    const raw = session?.getItem(PENDING_KEY);
    session?.removeItem(PENDING_KEY);
    return raw ? (JSON.parse(raw) as PendingSave) : null;
  } catch {
    return null;
  }
}
