// Thin client for the Patiamor Worker API (same origin in every environment).
import type { Energy, PetDetail, PetSummary, LatLng, Place, Sex, Size, Species } from './data';
import type { AdoptionRequest, ContactPref, MyRequest, RequestForm, RequestStatus } from './store';

export interface Me {
  id: string;
  email: string;
  name: string | null;
  phone?: string | null;
  contactPref?: ContactPref | null;
  /** New requests paused after several withdrawals, until Patiamor clears the account. */
  requestsRestricted?: boolean;
  isAdmin: boolean;
  shelters?: { id: string; name: string; status?: ShelterStatus; role: 'owner' | 'maintainer' }[];
  /** Approved to register shelters (admins are): everyone else asks first. */
  shelterOwner?: boolean;
  /** Their request to be a shelter owner: the one waiting, or decided in the last 30 days. */
  ownerRequest?: OwnerRequest | null;
}

/** A request to be allowed to register a shelter. An admin gets to know the person and approves. */
export interface OwnerRequest {
  id: string;
  shelterName: string;
  zone: string;
  status: 'pending' | 'approved' | 'declined';
  createdAt: string;
  decidedAt: string | null;
  note: string | null;
}
export interface OwnerForm {
  shelterName: string;
  zone: string;
  phone: string;
  link: string;
  about: string;
  consent: boolean;
}
/** An adopter whose new requests are paused (three withdrawals in 90 days), as an admin sees them. */
export interface AdminPaused {
  id: string;
  who: { name: string | null; email: string; phone: string | null };
  /** When they withdrew the last one. */
  since: string;
  withdrawals: { pet: string; shelter: string | null; reason: string | null; at: string }[];
  /** Their requests in progress, and animals already adopted through Patiamor. */
  open: number;
  adopted: number;
}
/** A person as an admin sees them when verifying adopters (PAT-2). */
export interface AdminAdopter {
  id: string;
  who: { name: string | null; email: string; phone: string | null };
  /** When they made their account. */
  since: string;
  /** The badge, with who gave it and how they know the person (admins only). */
  verified: { at: string; by: string | null; note: string | null } | null;
  requests: { open: number; adopted: number; withdrawn90: number };
}
/** A shelter or another request that may be the same one, for the admin to check before approving. */
export interface LookAlike {
  kind: 'shelter' | 'request';
  why: 'same_name' | 'shared_word' | 'same_phone';
  name: string;
  status: string;
  who?: string;
}
export interface AdminOwnerRequest extends OwnerRequest {
  link: string | null;
  about: string;
  who: { name: string | null; email: string; phone: string };
  lookAlikes: LookAlike[];
}

export type ShelterStatus = 'pending' | 'verified' | 'rejected' | 'suspended';
export type ReferenceKind = 'veterinaria' | 'refugio' | 'otro';
export interface Reference {
  name: string;
  contact: string;
  kind: ReferenceKind;
}

/** A shelter as its members see it in the portal. */
export interface PortalShelter {
  id: string;
  name: string;
  slug: string;
  status: ShelterStatus;
  statusReason: string | null;
  place: Place | null;
  role: 'owner' | 'maintainer';
  submittedAt?: string | null;
  /** Requests no one at the shelter has opened yet. */
  newRequests?: number;
  description?: string | null;
  publicPhone?: string | null;
  email?: string | null;
  website?: string | null;
  visitHours?: string | null;
}

/** What Patiamor needs to verify a shelter. Private: never shown to adopters. */
export interface ShelterApplication {
  contactName: string;
  contactPhone: string;
  rnc: string | null;
  address: string;
  social: string[];
  history: string;
  /** The first is required; up to two more. */
  references: Reference[];
  submittedAt?: string;
}

/** The registration form's body: the public profile, the private application, and the rules. */
export interface ShelterForm {
  name: string;
  placeId: string;
  description: string;
  visitHours: string;
  publicPhone: string;
  email: string;
  website: string;
  contactName: string;
  contactPhone: string;
  rnc: string;
  address: string;
  social: string[];
  history: string;
  references: { name: string; contact: string; kind: ReferenceKind | '' }[];
  rules: boolean;
}

export interface AdminShelter extends Omit<PortalShelter, 'role'> {
  owners: string | null;
  application: ShelterApplication | null;
}

export type PetStatus = 'draft' | 'in_review' | 'available' | 'reserved' | 'adopted' | 'withdrawn';

/** A shelter as its listing screens need it. */
export interface ListingShelter {
  id: string;
  name: string;
  status: ShelterStatus;
  place: Place | null;
  role: 'owner' | 'maintainer';
}

/** A listing as the form edits it (and sends it back). */
export interface PetForm {
  species: Species;
  name: string;
  sex: Sex;
  birthDate: string;
  birthDateEstimated: boolean;
  size: Size;
  energy: Energy;
  goodWith: { kids: boolean | null; dogs: boolean | null; cats: boolean | null };
  health: { vaccinated: boolean; sterilized: boolean; dewormed: boolean };
  story: string;
  needs: string[];
  adoptionFeeDop: number | null;
  inCareSince: string | null;
}

export interface ListingPhoto {
  id: string;
  url: string;
  thumb: string | null;
  focus: string;
}

export interface Listing extends PetForm {
  id: string;
  status: PetStatus;
  requestsPaused: boolean;
  openRequests: number;
  updatedAt: string;
  photos: ListingPhoto[];
}

export type ListingSummary = PetSummary & { status: PetStatus; openRequests: number; updatedAt: string };

export type CloseReason = 'otra_familia' | 'no_encaja' | 'sin_respuesta' | 'otro';
/** A special request to adopt more than Mi lista's three (a farm, a large family home). */
export type BulkStatus = 'pending' | 'approved' | 'declined';
export type BulkSpecies = 'perros' | 'gatos' | 'ambos';
export interface BulkRequest {
  id: string;
  status: BulkStatus;
  animals: number;
  species: BulkSpecies;
  createdAt: string;
  decidedAt: string | null;
  /** What the admin wrote: the reason for a no, or a word for a yes. */
  note: string | null;
}
export interface BulkForm {
  animals: number;
  species: BulkSpecies;
  wanted: string;
  about: string;
  phone: string;
  consent: boolean;
}
/** A special request as an admin reads it, with what's needed to weigh it. */
export interface AdminBulk extends Omit<BulkRequest, 'species'> {
  species: BulkSpecies;
  wanted: string | null;
  about: string;
  who: { name: string | null; email: string; phone: string | null };
  inProgress: { pet: string; shelter: string | null; status: string }[];
  /** Requests they withdrew in the last 90 days, and animals already adopted through Patiamor. */
  withdrawn90: number;
  adopted: number;
}

/** Why a shelter withdrew an animal: for its own records; adopters only see "Ya no está disponible". */
export type WithdrawReason = 'familia_original' | 'salud' | 'fallecio' | 'otro';
/** An animal's state after a lifecycle change, and how many open requests that change closed. */
export type PetChange = { pet: { id: string; status: PetStatus; requestsPaused: boolean }; closed: number };
/** What an old link to an adopted or withdrawn animal still shows (the API answers 410 "gone"). */
export interface GonePet {
  id: string;
  name: string;
  species: Species;
  status: 'adopted' | 'withdrawn';
  photo: PetSummary['photo'];
}

/** A request as the shelter's inbox shows it. Contact details only come while it's open. */
export interface InboxRequest {
  id: string;
  status: RequestStatus;
  createdAt: string;
  updatedAt: string;
  seenAt: string | null;
  closedReason: string | null;
  answers: { space: string; time: string; cost: string };
  about: { home: string | null; otherPets: string[]; kids: string | null; experience: string | null; visit: string | null; distanceKm: number | null; travel: 'si' | 'pensando' | null };
  message: string | null;
  contact: { name: string; email?: string; phone?: string | null; pref?: ContactPref };
  /** "Verificado por Patiamor": an admin has checked this person out or knows them. */
  verified: boolean;
  pet: { id: string; name: string; species: string; status: PetStatus; requestsPaused: boolean; openRequests: number; photo: { url: string | null; thumb: string | null; focus: string } };
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

async function call<T>(path: string, method = 'GET', body?: unknown, fresh = false): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    // Public reads may come from the browser's cache (up to a minute); `fresh` asks the server again.
    cache: fresh ? 'no-cache' : 'default',
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
  authConfig: () => call<{ turnstile: string | null }>('/api/auth/config'),
  startEmail: (email: string, next: string, turnstile?: string) => call<{ ok: true }>('/api/auth/email/start', 'POST', { email, next, turnstile }),
  verifyEmail: (email: string, code: string) => call<{ user: Me }>('/api/auth/email/verify', 'POST', { email, code }).then((r) => r.user),
  emailLink: (token: string) => call<{ user: Me }>('/api/auth/email/link', 'POST', { token }).then((r) => r.user),
  logout: () => call<{ ok: true }>('/api/auth/logout', 'POST', {}),
  googleUrl: (next: string) => `/api/auth/google/start?next=${encodeURIComponent(next)}`,

  // Coordinates are rounded to ~1 km before they leave the device. The server snaps them to a ~55 km
  // square and everyone in that square shares one cached list; the phone works out exact distances.
  pets: (from: LatLng, fresh = false) => call<{ pets: PetSummary[]; truncated: boolean }>(`/api/pets?${point(from)}`, 'GET', undefined, fresh),
  /** Animals whose name starts with a typed word, from the database (the app's own list may not have them). */
  findPets: (q: string) => call<{ pets: PetSummary[] }>(`/api/pets/find?q=${encodeURIComponent(q)}`).then((r) => r.pets),
  // Profiles are the same for everyone (and cached at Cloudflare's edge); the phone adds the distance.
  pet: (id: string, fresh = false) => call<{ pet: PetDetail }>(`/api/pets/${encodeURIComponent(id)}`, 'GET', undefined, fresh).then((r) => r.pet),
  searchPlaces: (q: string) => call<{ places: Place[] }>(`/api/places?q=${encodeURIComponent(q)}`).then((r) => r.places),
  nearestPlace: (at: LatLng) => call<{ place: Place }>(`/api/places/nearest?${point(at)}`).then((r) => r.place),
  whereami: () => call<{ place: Place; source: 'ip' | 'default' }>('/api/whereami'),
  myRequests: () => call<{ items: MyRequest[]; alerts: string[]; bulk: BulkRequest | null }>('/api/requests'),
  sendBulk: (form: BulkForm) => call<{ bulk: BulkRequest }>('/api/requests/bulk', 'POST', form).then((r) => r.bulk),
  requestAdoption: (form: RequestForm) => call<{ request: AdoptionRequest }>('/api/requests', 'POST', form).then((r) => r.request),
  withdrawRequest: (id: string, reason: string) => call<{ ok: true }>(`/api/requests/${encodeURIComponent(id)}/withdraw`, 'POST', { reason }),
  alertOn: (petId: string) => call<{ ok: true }>(`/api/alerts/${encodeURIComponent(petId)}`, 'PUT', {}),
  alertOff: (petId: string) => call<{ ok: true }>(`/api/alerts/${encodeURIComponent(petId)}`, 'DELETE', {}),

  // The shelter portal and the verification queue.
  myShelters: () => call<{ shelters: PortalShelter[] }>('/api/portal/shelters').then((r) => r.shelters),
  registerShelter: (form: ShelterForm) => call<{ shelter: { id: string; slug: string; status: ShelterStatus } }>('/api/portal/shelters', 'POST', form).then((r) => r.shelter),
  shelter: (id: string) => call<{ shelter: PortalShelter; application: ShelterApplication | null }>(`/api/portal/shelters/${encodeURIComponent(id)}`),
  resubmitShelter: (id: string, form: ShelterForm) => call<{ shelter: { id: string; status: ShelterStatus } }>(`/api/portal/shelters/${encodeURIComponent(id)}/application`, 'PUT', form),
  shelterPets: (id: string) => call<{ shelter: ListingShelter; pets: ListingSummary[] }>(`/api/portal/shelters/${encodeURIComponent(id)}/pets`),
  createPet: (shelterId: string, form: PetForm, publish: boolean) =>
    call<{ pet: { id: string; status: PetStatus } }>(`/api/portal/shelters/${encodeURIComponent(shelterId)}/pets`, 'POST', { ...form, publish }).then((r) => r.pet),
  listing: (petId: string) => call<{ shelter: ListingShelter; pet: Listing }>(`/api/portal/pets/${encodeURIComponent(petId)}`),
  savePet: (petId: string, form: PetForm, publish: boolean) =>
    call<{ pet: { id: string; status: PetStatus } }>(`/api/portal/pets/${encodeURIComponent(petId)}`, 'PUT', { ...form, publish }).then((r) => r.pet),
  uploadPhoto: (petId: string, body: { image: string; thumb: string; focus: string }) =>
    call<{ photo: ListingPhoto }>(`/api/portal/pets/${encodeURIComponent(petId)}/photos`, 'POST', body).then((r) => r.photo),
  arrangePhotos: (petId: string, photos: { id: string; focus: string }[]) => call<{ ok: true }>(`/api/portal/pets/${encodeURIComponent(petId)}/photos`, 'PUT', { photos }),
  deletePhoto: (petId: string, photoId: string) =>
    call<{ ok: true }>(`/api/portal/pets/${encodeURIComponent(petId)}/photos/${encodeURIComponent(photoId)}`, 'DELETE', {}),
  shelterRequests: (shelterId: string) => call<{ requests: InboxRequest[] }>(`/api/portal/shelters/${encodeURIComponent(shelterId)}/requests`).then((r) => r.requests),
  moveRequest: (id: string, status: 'seen' | 'contacted' | 'visit' | 'closed', reason?: CloseReason) =>
    call<{ request: InboxRequest }>(`/api/portal/requests/${encodeURIComponent(id)}/status`, 'POST', { status, reason }).then((r) => r.request),
  setAvailability: (petId: string, change: { reserved?: boolean; paused?: boolean }) =>
    call<{ pet: { id: string; status: PetStatus; requestsPaused: boolean } }>(`/api/portal/pets/${encodeURIComponent(petId)}/availability`, 'POST', change).then((r) => r.pet),
  markAdopted: (petId: string, requestId?: string) => call<PetChange>(`/api/portal/pets/${encodeURIComponent(petId)}/adopted`, 'POST', { requestId }),
  withdrawPet: (petId: string, reason: WithdrawReason) => call<PetChange>(`/api/portal/pets/${encodeURIComponent(petId)}/withdraw`, 'POST', { reason }),
  relistPet: (petId: string) => call<PetChange>(`/api/portal/pets/${encodeURIComponent(petId)}/relist`, 'POST', {}),
  runDigest: () => call<{ shelters: number; digestEmails: number; alertEmails: number; deferred: boolean }>('/api/admin/digest', 'POST', {}),
  /** How many of each kind of request are waiting for an admin. */
  adminSummary: () => call<{ shelters: number; owners: number; bulk: number; paused: number }>('/api/admin/summary'),
  adminPaused: () => call<{ paused: AdminPaused[] }>('/api/admin/paused').then((r) => r.paused),
  adminClearPause: (userId: string, note?: string) => call<{ cleared: { id: string } }>(`/api/admin/paused/${encodeURIComponent(userId)}/clear`, 'POST', { note }),
  adminAdopters: () => call<{ adopters: AdminAdopter[] }>('/api/admin/adopters').then((r) => r.adopters),
  adminFindAdopter: (email: string) => call<{ adopter: AdminAdopter | null }>(`/api/admin/adopters/lookup?email=${encodeURIComponent(email)}`).then((r) => r.adopter),
  adminVerifyAdopter: (id: string, note: string) => call<{ adopter: { id: string; verified: boolean } }>(`/api/admin/adopters/${encodeURIComponent(id)}/verify`, 'POST', { note }),
  adminUnverifyAdopter: (id: string, note?: string) => call<{ adopter: { id: string; verified: boolean } }>(`/api/admin/adopters/${encodeURIComponent(id)}/unverify`, 'POST', { note }),
  adminShelters: (status: ShelterStatus) => call<{ shelters: AdminShelter[] }>(`/api/admin/shelters?status=${status}`).then((r) => r.shelters),
  adminBulk: (status: BulkStatus) => call<{ requests: AdminBulk[] }>(`/api/admin/bulk?status=${status}`).then((r) => r.requests),
  adminBulkDecision: (id: string, action: 'approve' | 'decline', note?: string) =>
    call<{ bulk: { id: string; status: BulkStatus } }>(`/api/admin/bulk/${encodeURIComponent(id)}/decision`, 'POST', { action, note }),
  sendOwnerRequest: (form: OwnerForm) => call<{ request: OwnerRequest }>('/api/portal/owner-request', 'POST', form).then((r) => r.request),
  adminOwners: (status: BulkStatus) => call<{ requests: AdminOwnerRequest[] }>(`/api/admin/owners?status=${status}`).then((r) => r.requests),
  adminOwnerDecision: (id: string, action: 'approve' | 'decline', note?: string) =>
    call<{ request: { id: string; status: BulkStatus } }>(`/api/admin/owners/${encodeURIComponent(id)}/decision`, 'POST', { action, note }),
  /** Registers a shelter for someone (it starts verified): the usual form plus the owner's email. */
  adminRegisterShelter: (ownerEmail: string, form: ShelterForm) =>
    call<{ shelter: { id: string; slug: string; status: ShelterStatus } }>('/api/admin/shelters', 'POST', { ...form, ownerEmail }).then((r) => r.shelter),
  adminDecision: (id: string, action: 'verify' | 'reject' | 'suspend', reason?: string) =>
    call<{ shelter: { id: string; status: ShelterStatus } }>(`/api/admin/shelters/${encodeURIComponent(id)}/decision`, 'POST', { action, reason }),
};

function point({ lat, lng }: LatLng) {
  return `lat=${lat.toFixed(2)}&lng=${lng.toFixed(2)}`;
}
