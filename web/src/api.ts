// Thin client for the Patiamor Worker API (same origin in every environment).
import type { Donation, DonationAccount, Energy, HelpCase, HelpCaseDetail, HelpNeed, LostKind, LostPost, LostPostDetail, PetDetail, PetSummary, LatLng, Place, Sex, Size, Species } from './data';
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
  /** Their request to list as a private person (no shelter): the same. */
  listerRequest?: OwnerRequest | null;
  /** They've read the rules for listing (shown before their first animal). */
  listerRules?: boolean;
}

/** A request to be allowed to register a shelter. An admin gets to know the person and approves. */
export interface OwnerRequest {
  id: string;
  /** A shelter's owner, or a private person who rehomes animals (they have no shelter name). */
  kind: 'shelter' | 'private';
  shelterName: string;
  zone: string;
  status: 'pending' | 'approved' | 'declined';
  createdAt: string;
  decidedAt: string | null;
  note: string | null;
}
/** A private person asking to list (no shelter): where they are, and who. */
export interface ListerForm {
  placeId: string;
  phone: string;
  link: string;
  about: string;
  consent: boolean;
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
  /** Where a private person says they are. */
  place: Place | null;
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
  /** A shelter, or a private person's one-person profile ("Particular"). */
  kind: 'shelter' | 'private';
  submittedAt?: string | null;
  /** Requests no one at the shelter has opened yet. */
  newRequests?: number;
  /** For a suspended shelter: its latest request to lift it. */
  review?: ShelterReview | null;
  description?: string | null;
  publicPhone?: string | null;
  email?: string | null;
  website?: string | null;
  visitHours?: string | null;
  /** Only in the one-shelter answer (api.shelter). */
  donation?: Donation | null;
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

export interface AdminShelter extends Omit<PortalShelter, 'role' | 'review'> {
  owners: string | null;
  application: ShelterApplication | null;
  feeCapDop: number;
  /** An admin set this shelter's cap (otherwise it's the default). */
  feeCapRaised: boolean;
  /** A suspended shelter's request to lift it, while it waits. */
  review: { id: string; message: string; createdAt: string } | null;
}

export type ReportReason = 'venta' | 'estafa' | 'maltrato' | 'datos_falsos' | 'otro';

/** Why a listing is hidden while Patiamor reviews it: reports, or money language in its text. */
export interface ListingReview {
  reason: 'reportes' | 'dinero';
  words: string[];
  at?: string | null;
}

/** A listing in the admin's review queue: hidden, or reported and not yet looked at. */
export interface AdminReviewPet {
  id: string;
  name: string;
  species: string;
  status: PetStatus;
  openRequests: number;
  story: string;
  needs: string[];
  shelter: { id: string; name: string | null } | null;
  photo: { url: string | null; thumb: string | null; focus: string };
  review: ListingReview | null;
  reports: { reason: ReportReason; details: string | null; at: string; by: string | null }[];
}

/** A suspended shelter's owner asking to lift the suspension, and how it was answered. */
export interface ShelterReview {
  id: string;
  status: 'pending' | 'lifted' | 'kept';
  message: string;
  /** Why it was kept: the owner reads it. */
  note: string | null;
  createdAt: string;
  decidedAt: string | null;
}

export type PetStatus = 'draft' | 'in_review' | 'available' | 'reserved' | 'adopted' | 'withdrawn';

/** A shelter as its listing screens need it. */
export interface ListingShelter {
  id: string;
  name: string;
  status: ShelterStatus;
  place: Place | null;
  role: 'owner' | 'maintainer';
  kind: 'shelter' | 'private';
  /** The most it may ask as an adoption fee: RD$2,000 unless an admin raised it. */
  feeCapDop: number;
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
  /** Why it's hidden, while Patiamor reviews it. */
  review: ListingReview | null;
}

export type ListingSummary = PetSummary & { status: PetStatus; openRequests: number; updatedAt: string };
/** One change for several animals at once. */
export type ManyChange =
  | { ids: string[]; action: 'reserved' | 'available' | 'adopted' }
  | { ids: string[]; action: 'withdrawn'; reason: WithdrawReason }
  | { ids: string[]; action: 'health'; health: Partial<Record<'vaccinated' | 'sterilized' | 'dewormed', boolean>> };

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

export type CaseStatus = 'draft' | 'open' | 'resolved' | 'closed';
/** A help case as its form edits it (and sends it back). */
export interface CaseForm {
  species: Species;
  name: string;
  need: HelpNeed;
  story: string;
  costDop: number | null;
  alsoNeeded: string | null;
  /** The same animal's listing, if it has one. */
  petId: string | null;
}
/** A case in the portal, every status. `stale`: open, but hidden for want of news in 60 days. */
export interface PortalCase extends CaseForm {
  id: string;
  status: CaseStatus;
  outcome: string | null;
  publishedAt: string | null;
  activeAt: string | null;
  endedAt: string | null;
  updatedAt: string;
  stale: boolean;
}
/** The shelter as the case screens need it; an admin may publish for any shelter. */
export interface CaseShelter {
  id: string;
  name: string;
  status: ShelterStatus;
  role: 'owner' | 'maintainer' | 'admin';
  hasDonation: boolean;
}
/** The shelter's animals a case can be linked to. */
export type CasePet = { id: string; name: string; species: Species };

/** A lost and found post as its form edits it. */
export interface LostForm {
  kind: LostKind;
  species: Species;
  name: string | null;
  sex: Sex | null;
  description: string;
  placeId: string;
  seenOn: string;
}
export type LostStatus = 'draft' | 'open' | 'home' | 'closed';
/** A post in the portal. `expired`: open, but hidden after 30 days without a renewal. */
export interface PortalLost extends Omit<LostForm, 'placeId'> {
  id: string;
  place: Place | null;
  status: LostStatus;
  publishedAt: string | null;
  activeAt: string | null;
  endedAt: string | null;
  updatedAt: string;
  expired: boolean;
}
export interface LostShelter extends Omit<CaseShelter, 'hasDonation'> {
  hasPhone: boolean;
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
  /** Replaces the shelter's accounts; none removes them all. */
  saveDonation: (id: string, form: { accounts: Record<keyof DonationAccount, string>[]; note: string }) =>
    call<{ donation: Donation | null }>(`/api/portal/shelters/${encodeURIComponent(id)}/donation`, 'PUT', form).then((r) => r.donation),
  shelterPets: (id: string) => call<{ shelter: ListingShelter; pets: ListingSummary[] }>(`/api/portal/shelters/${encodeURIComponent(id)}/pets`),
  createPet: (shelterId: string, form: PetForm, publish: boolean) =>
    call<{ pet: { id: string; status: PetStatus } }>(`/api/portal/shelters/${encodeURIComponent(shelterId)}/pets`, 'POST', { ...form, publish }).then((r) => r.pet),
  listing: (petId: string) => call<{ shelter: ListingShelter; pet: Listing }>(`/api/portal/pets/${encodeURIComponent(petId)}`),
  /** `review` when saving sent it to review (money language in a live listing). */
  savePet: (petId: string, form: PetForm, publish: boolean) =>
    call<{ pet: { id: string; status: PetStatus }; review?: ListingReview }>(`/api/portal/pets/${encodeURIComponent(petId)}`, 'PUT', { ...form, publish }).then((r) => ({ ...r.pet, review: r.review ?? null })),
  uploadPhoto: (petId: string, body: { image: string; thumb: string; focus: string }) =>
    call<{ photo: ListingPhoto }>(`/api/portal/pets/${encodeURIComponent(petId)}/photos`, 'POST', body).then((r) => r.photo),
  arrangePhotos: (petId: string, photos: { id: string; focus: string }[]) => call<{ ok: true }>(`/api/portal/pets/${encodeURIComponent(petId)}/photos`, 'PUT', { photos }),
  deletePhoto: (petId: string, photoId: string) =>
    call<{ ok: true }>(`/api/portal/pets/${encodeURIComponent(petId)}/photos/${encodeURIComponent(photoId)}`, 'DELETE', {}),
  shelterRequests: (shelterId: string) => call<{ requests: InboxRequest[] }>(`/api/portal/shelters/${encodeURIComponent(shelterId)}/requests`).then((r) => r.requests),
  moveRequest: (id: string, status: 'seen' | 'contacted' | 'visit' | 'closed', reason?: CloseReason) =>
    call<{ request: InboxRequest }>(`/api/portal/requests/${encodeURIComponent(id)}/status`, 'POST', { status, reason }).then((r) => r.request),
  /** Several of the shelter's animals at once (PAT-33); those that can't take the change come back in `skipped`. */
  changeMany: (shelterId: string, change: ManyChange) =>
    call<{ changed: string[]; skipped: { id: string; why: 'not_found' | 'not_live' | 'already' | 'has_requests' }[]; closed: number }>(
      `/api/portal/shelters/${encodeURIComponent(shelterId)}/pets/bulk`,
      'POST',
      change,
    ),
  setAvailability: (petId: string, change: { reserved?: boolean; paused?: boolean }) =>
    call<{ pet: { id: string; status: PetStatus; requestsPaused: boolean } }>(`/api/portal/pets/${encodeURIComponent(petId)}/availability`, 'POST', change).then((r) => r.pet),
  markAdopted: (petId: string, requestId?: string) => call<PetChange>(`/api/portal/pets/${encodeURIComponent(petId)}/adopted`, 'POST', { requestId }),
  withdrawPet: (petId: string, reason: WithdrawReason) => call<PetChange>(`/api/portal/pets/${encodeURIComponent(petId)}/withdraw`, 'POST', { reason }),
  relistPet: (petId: string) => call<PetChange>(`/api/portal/pets/${encodeURIComponent(petId)}/relist`, 'POST', {}),
  // Help cases: the public list and pages, then the shelter's side.
  helpCases: () => call<{ cases: HelpCase[] }>('/api/cases').then((r) => r.cases),
  helpCase: (id: string) => call<{ case: HelpCaseDetail }>(`/api/cases/${encodeURIComponent(id)}`).then((r) => r.case),
  shelterCases: (shelterId: string) =>
    call<{ shelter: CaseShelter; cases: (PortalCase & { photo: { url: string; thumb: string | null; focus: string } | null })[]; pets: CasePet[] }>(`/api/portal/shelters/${encodeURIComponent(shelterId)}/cases`),
  createCase: (shelterId: string, form: CaseForm) => call<{ case: { id: string; status: CaseStatus } }>(`/api/portal/shelters/${encodeURIComponent(shelterId)}/cases`, 'POST', form).then((r) => r.case),
  portalCase: (caseId: string) =>
    call<{ shelter: CaseShelter; case: PortalCase & { photos: ListingPhoto[]; updates: { id: string; body: string; at: string }[] }; pets: CasePet[] }>(`/api/portal/cases/${encodeURIComponent(caseId)}`),
  saveCase: (caseId: string, form: CaseForm, publish: boolean) => call<{ case: { id: string; status: CaseStatus } }>(`/api/portal/cases/${encodeURIComponent(caseId)}`, 'PUT', { ...form, publish }).then((r) => r.case),
  deleteCase: (caseId: string) => call<{ ok: true }>(`/api/portal/cases/${encodeURIComponent(caseId)}`, 'DELETE', {}),
  postCaseUpdate: (caseId: string, body: string) => call<{ update: { id: string; body: string; at: string } }>(`/api/portal/cases/${encodeURIComponent(caseId)}/updates`, 'POST', { body }).then((r) => r.update),
  deleteCaseUpdate: (caseId: string, updateId: string) => call<{ ok: true }>(`/api/portal/cases/${encodeURIComponent(caseId)}/updates/${encodeURIComponent(updateId)}`, 'DELETE', {}),
  endCase: (caseId: string, status: 'resolved' | 'closed', outcome: string) => call<{ case: { id: string; status: CaseStatus } }>(`/api/portal/cases/${encodeURIComponent(caseId)}/end`, 'POST', { status, outcome }),
  uploadCasePhoto: (caseId: string, body: { image: string; thumb: string; focus: string }) =>
    call<{ photo: ListingPhoto }>(`/api/portal/cases/${encodeURIComponent(caseId)}/photos`, 'POST', body).then((r) => r.photo),
  arrangeCasePhotos: (caseId: string, photos: { id: string; focus: string }[]) => call<{ ok: true }>(`/api/portal/cases/${encodeURIComponent(caseId)}/photos`, 'PUT', { photos }),
  deleteCasePhoto: (caseId: string, photoId: string) => call<{ ok: true }>(`/api/portal/cases/${encodeURIComponent(caseId)}/photos/${encodeURIComponent(photoId)}`, 'DELETE', {}),
  // Lost and found: the public list and pages, then the shelter's side.
  lostPosts: () => call<{ posts: LostPost[] }>('/api/lost').then((r) => r.posts),
  lostPost: (id: string) => call<{ post: LostPostDetail }>(`/api/lost/${encodeURIComponent(id)}`).then((r) => r.post),
  shelterLost: (shelterId: string) =>
    call<{ shelter: LostShelter; posts: (PortalLost & { photo: { url: string; thumb: string | null; focus: string } | null })[] }>(`/api/portal/shelters/${encodeURIComponent(shelterId)}/lost`),
  createLost: (shelterId: string, form: LostForm) => call<{ post: { id: string; status: LostStatus } }>(`/api/portal/shelters/${encodeURIComponent(shelterId)}/lost`, 'POST', form).then((r) => r.post),
  portalLost: (postId: string) => call<{ shelter: LostShelter; post: PortalLost & { photos: ListingPhoto[] } }>(`/api/portal/lost/${encodeURIComponent(postId)}`),
  saveLost: (postId: string, form: LostForm, publish: boolean) => call<{ post: { id: string; status: LostStatus } }>(`/api/portal/lost/${encodeURIComponent(postId)}`, 'PUT', { ...form, publish }).then((r) => r.post),
  renewLost: (postId: string) => call<{ post: { id: string; activeAt: string } }>(`/api/portal/lost/${encodeURIComponent(postId)}/renew`, 'POST', {}),
  endLost: (postId: string, status: 'home' | 'closed') => call<{ post: { id: string; status: LostStatus } }>(`/api/portal/lost/${encodeURIComponent(postId)}/end`, 'POST', { status }),
  deleteLost: (postId: string) => call<{ ok: true }>(`/api/portal/lost/${encodeURIComponent(postId)}`, 'DELETE', {}),
  uploadLostPhoto: (postId: string, body: { image: string; thumb: string; focus: string }) =>
    call<{ photo: ListingPhoto }>(`/api/portal/lost/${encodeURIComponent(postId)}/photos`, 'POST', body).then((r) => r.photo),
  arrangeLostPhotos: (postId: string, photos: { id: string; focus: string }[]) => call<{ ok: true }>(`/api/portal/lost/${encodeURIComponent(postId)}/photos`, 'PUT', { photos }),
  deleteLostPhoto: (postId: string, photoId: string) => call<{ ok: true }>(`/api/portal/lost/${encodeURIComponent(postId)}/photos/${encodeURIComponent(photoId)}`, 'DELETE', {}),
  /** The phone people see on lost and found posts; owners change it any time. */
  savePublicPhone: (shelterId: string, phone: string) => call<{ publicPhone: string }>(`/api/portal/shelters/${encodeURIComponent(shelterId)}/phone`, 'PUT', { phone }).then((r) => r.publicPhone),
  runDigest: () => call<{ shelters: number; digestEmails: number; alertEmails: number; closedEmails: number; deferred: boolean }>('/api/admin/digest', 'POST', {}),
  /** How many of each kind of request are waiting for an admin. */
  adminSummary: () => call<{ shelters: number; owners: number; bulk: number; paused: number; reports: number }>('/api/admin/summary'),
  adminPaused: () => call<{ paused: AdminPaused[] }>('/api/admin/paused').then((r) => r.paused),
  adminClearPause: (userId: string, note?: string) => call<{ cleared: { id: string } }>(`/api/admin/paused/${encodeURIComponent(userId)}/clear`, 'POST', { note }),
  adminAdopters: () => call<{ adopters: AdminAdopter[] }>('/api/admin/adopters').then((r) => r.adopters),
  adminFindAdopter: (email: string) => call<{ adopter: AdminAdopter | null }>(`/api/admin/adopters/lookup?email=${encodeURIComponent(email)}`).then((r) => r.adopter),
  adminVerifyAdopter: (id: string, note: string) => call<{ adopter: { id: string; verified: boolean } }>(`/api/admin/adopters/${encodeURIComponent(id)}/verify`, 'POST', { note }),
  adminUnverifyAdopter: (id: string, note?: string) => call<{ adopter: { id: string; verified: boolean } }>(`/api/admin/adopters/${encodeURIComponent(id)}/unverify`, 'POST', { note }),
  adminShelters: (status: ShelterStatus) => call<{ shelters: AdminShelter[]; pendingReviews: number }>(`/api/admin/shelters?status=${status}`),
  adminKeepSuspension: (shelterId: string, note: string) => call<{ review: { status: 'kept' } }>(`/api/admin/shelters/${encodeURIComponent(shelterId)}/review/keep`, 'POST', { note }),
  adminFeeCap: (shelterId: string, capDop: number | null) => call<{ shelter: { id: string; feeCapDop: number } }>(`/api/admin/shelters/${encodeURIComponent(shelterId)}/fee-cap`, 'POST', { capDop }),
  reportPet: (petId: string, reason: ReportReason, details?: string) => call<{ report: { received: boolean } }>(`/api/pets/${encodeURIComponent(petId)}/report`, 'POST', { reason, details }),
  adminReports: () => call<{ pets: AdminReviewPet[] }>('/api/admin/reports').then((r) => r.pets),
  adminRestorePet: (petId: string, note?: string) => call<{ restored: boolean }>(`/api/admin/pets/${encodeURIComponent(petId)}/restore`, 'POST', { note }),
  adminTakedownPet: (petId: string, note: string) => call<{ closed: number }>(`/api/admin/pets/${encodeURIComponent(petId)}/takedown`, 'POST', { note }),
  acceptListerRules: () => call<{ listerRules: boolean }>('/api/me/lister-rules', 'POST', {}),
  requestReview: (shelterId: string, message: string) => call<{ review: ShelterReview }>(`/api/portal/shelters/${encodeURIComponent(shelterId)}/review`, 'POST', { message }).then((r) => r.review),
  adminBulk: (status: BulkStatus) => call<{ requests: AdminBulk[] }>(`/api/admin/bulk?status=${status}`).then((r) => r.requests),
  adminBulkDecision: (id: string, action: 'approve' | 'decline', note?: string) =>
    call<{ bulk: { id: string; status: BulkStatus } }>(`/api/admin/bulk/${encodeURIComponent(id)}/decision`, 'POST', { action, note }),
  sendListerRequest: (form: ListerForm) => call<{ request: OwnerRequest }>('/api/portal/owner-request', 'POST', { ...form, kind: 'private' }).then((r) => r.request),
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
