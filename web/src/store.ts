import { api, type Me } from './api';
import { ageGroup, ageMonths, companionKey, type SpeciesFilter, type AgeGroup, type Companion, type PetDetail, type PetSummary, type Energy, type Place, type Sex, type Size } from './data';
import { bearing, distanceKm } from './geo';

export type Answer = 'si' | 'pensando';
export interface Answers {
  space: Answer;
  time: Answer;
  cost: Answer;
}
/** One of Mi lista's slots (or a recently ended one): an adoption request, with the pet and the reflection answers. */
export interface MyRequest {
  pet: PetSummary;
  answers: Answers;
  request: AdoptionRequest;
}

export type RequestStatus = 'sent' | 'seen' | 'contacted' | 'visit' | 'adopted' | 'closed' | 'withdrawn';
export interface AdoptionRequest {
  id: string;
  status: RequestStatus;
  createdAt: string;
  updatedAt?: string;
}
export const isOpen = (r: AdoptionRequest | null | undefined) => !!r && ['sent', 'seen', 'contacted', 'visit'].includes(r.status);

export type ContactPref = 'whatsapp' | 'llamada' | 'correo';

/** What "Sí, quiero empezar el proceso" sends: reflection, contact, consent; the rest is optional. */
export interface RequestForm {
  petId: string;
  answers: Answers;
  name: string;
  phone: string;
  pref: ContactPref;
  home?: 'casa_patio' | 'casa' | 'apartamento';
  otherPets: ('perros' | 'gatos' | 'otros')[];
  kids?: 'no' | 'menores' | 'mayores';
  experience?: 'si' | 'primera';
  visit?: 'semana' | 'fin' | 'cualquiera';
  message: string;
  consent: boolean;
}

export interface Filters {
  size: Size[];
  age: AgeGroup[];
  sex: Sex[];
  energy: Energy[];
  goodWith: Companion[];
  /** Chosen on the map: one shelter's animals, or the private listings in one neighbourhood. */
  from: { kind: 'shelter' | 'place'; id: string; name: string } | null;
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
  /** Mi lista: open requests (the 3 slots) and ones that ended in the last 30 days. */
  requests: MyRequest[];
  /** Pets the person asked to hear about when they're available again. */
  alerts: string[];
  /** Pets set aside this session. They come back next session. */
  skipped: string[];
}

export const MAX_SLOTS = 3;
export const RADIUS_MIN = 1;
export const RADIUS_MAX = 150;

export const emptyFilters = (): Filters => ({ size: [], age: [], sex: [], energy: [], goodWith: [], from: null });

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
  requests: [],
  alerts: [],
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
  // The list reaches a little past the furthest radius (it's shared by a whole area); trim to it.
  placed = state.pets.map(place).filter((p) => p.km <= RADIUS_MAX);
  placedById = new Map(placed.map((p) => [p.pet.id, p]));
}

export function placePet(pet: PetSummary): Placed {
  return placedById.get(pet.id) ?? place(pet);
}

export function cachePets(pets: PetSummary[]) {
  for (const d of pets) if (!(petCache.get(d.id) as PetDetail | undefined)?.story) petCache.set(d.id, d);
}

let petsRequest = 0;
/** Loads the pets within reach of the chosen area; nearby areas share one cached list at the edge. */
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
  if (f.from?.kind === 'shelter' && !(pet.lister.type === 'shelter' && pet.lister.id === f.from.id)) return false;
  if (f.from?.kind === 'place' && !(pet.lister.type === 'private' && pet.place.id === f.from.id)) return false;
  return true;
}

export function inReach(radiusKm = state.radiusKm, filters = state.filters): Placed[] {
  return placed.filter((p) => p.km <= radiusKm && matchesFilters(p.pet, filters)).sort((a, b) => a.km - b.km);
}

/** The browse queue: in reach, not skipped this session, not already asked about. */
export function queue(): Placed[] {
  const listed = new Set(activeRequests().map((s) => s.pet.id));
  return inReach().filter((p) => !state.skipped.includes(p.pet.id) && !listed.has(p.pet.id));
}

/** In-radius counts per species (ignoring the species switch), shown on the switch itself. */
export function speciesCounts(radiusKm = state.radiusKm, filters = state.filters): Record<SpeciesFilter, number> {
  const c = { perro: 0, gato: 0, todos: 0 };
  for (const p of placed) if (p.km <= radiusKm && matchesFilters(p.pet, filters, 'todos')) c[p.pet.species]++, c.todos++;
  return c;
}

export function activeFilterCount(f = state.filters): number {
  return f.size.length + f.age.length + f.sex.length + f.energy.length + f.goodWith.length + (f.from ? 1 : 0);
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
    if (!user) (s.requests = []), (s.alerts = []);
  });
  if (user) void loadRequests().catch(() => {});
}

export async function loadRequests() {
  const { items, alerts } = await api.myRequests();
  cachePets(items.map((i) => i.pet));
  update((s) => ((s.requests = items), (s.alerts = alerts)));
}

/** The slots: requests still in progress, oldest first. */
export const activeRequests = () => state.requests.filter((r) => isOpen(r.request));
/** This pet's request in progress, if any. */
export const activeRequestFor = (petId: string) => activeRequests().find((r) => r.pet.id === petId) ?? null;

export async function sendRequest(form: RequestForm) {
  await api.requestAdoption(form);
  // The account now remembers how to reach them; keep the next form's prefill in step.
  update((s) => s.user && ((s.user.name = form.name), (s.user.phone = form.phone || s.user.phone), (s.user.contactPref = form.pref)));
  await loadRequests();
}

export async function withdrawRequest(id: string, reason: string | null) {
  await api.withdrawRequest(id, reason);
  await loadRequests();
}

export async function toggleAlert(petId: string) {
  const on = state.alerts.includes(petId);
  await (on ? api.alertOff(petId) : api.alertOn(petId));
  update((s) => (s.alerts = on ? s.alerts.filter((id) => id !== petId) : [...s.alerts, petId]));
}

/** A request started before signing in (Google and the email link leave the page); reopened on return. */
const PENDING_KEY = 'patiamor-pending-request';
export function stashPendingRequest(petId: string) {
  try {
    session?.setItem(PENDING_KEY, petId);
  } catch {
    /* ignore */
  }
}
export function takePendingRequest(): string | null {
  try {
    const id = session?.getItem(PENDING_KEY) ?? null;
    session?.removeItem(PENDING_KEY);
    return id;
  } catch {
    return null;
  }
}
