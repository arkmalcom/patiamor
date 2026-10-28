// Shapes returned by the Patiamor API, plus small helpers. Pets, shelters and places live in D1;
// staging is seeded with fictional sample data (api/seeds/staging.sql).
import { BRAND } from './brand';

export type Species = 'perro' | 'gato';
/** What the user is browsing: one species or both. */
export type SpeciesFilter = Species | 'todos';
export type Size = 'pequeno' | 'mediano' | 'grande';
export type Sex = 'hembra' | 'macho';
export type Energy = 'tranquila' | 'media' | 'alta';
export type AgeGroup = 'cachorro' | 'joven' | 'adulto' | 'mayor';
export type Companion = 'ninos' | 'perros' | 'gatos';
export type FrameColor = 'hoja' | 'mango' | 'anil' | 'turquesa';

export interface LatLng {
  lat: number;
  lng: number;
}

export interface Place extends LatLng {
  id: string;
  name: string;
  municipality: string;
  province: string;
  kind?: string;
  hint?: string | null;
}

export type Lister = { type: 'shelter'; id: string; name: string } | { type: 'private' };

export interface PetSummary {
  id: string;
  species: Species;
  name: string;
  sex: Sex;
  birthDate: string | null;
  birthDateEstimated: boolean;
  size: Size;
  energy: Energy;
  goodWith: { kids: boolean | null; dogs: boolean | null; cats: boolean | null };
  health: { vaccinated: boolean; sterilized: boolean; dewormed: boolean };
  litterId: string | null;
  status: string;
  /** Whether an adoption request can be sent: open, busy (several already), paused, or reserved ("en proceso"). */
  requests: 'open' | 'busy' | 'paused' | 'reserved';
  place: Place;
  lister: Lister;
  /** `thumb` (about 480 px) is for small frames; sample photos have none. */
  /** `count`: how many photos the pet has (the others arrive with the profile). */
  photo: { url: string | null; thumb?: string | null; focus: string; count?: number };
  km?: number;
}

export interface DonationAccount {
  bank: string;
  accountType: 'ahorros' | 'corriente';
  account: string;
  holder: string;
  /** Cédula or RNC, which transfers between banks ask for. */
  holderId: string | null;
}

/** A shelter's bank accounts for donations (up to four): the money goes straight to the shelter, never through Patiamor. */
export interface Donation {
  accounts: DonationAccount[];
  note: string | null;
}

export interface PetDetail extends PetSummary {
  story: string;
  needs: string[];
  inCareSince: string | null;
  adoptionFeeDop: number | null;
  photos: { url: string | null; focus: string }[];
  lister:
    | { type: 'shelter'; id: string; name: string; description: string | null; place: string | null; municipality: string | null; visitHours: string | null; donation?: Donation | null }
    | { type: 'private' };
  siblings: PetSummary[];
  /** The shelter's open help case for this same animal. */
  helpCase?: { id: string; need: HelpNeed } | null;
}

/** What a help case is for. */
export type HelpNeed = 'cirugia' | 'tratamiento' | 'examenes' | 'medicinas' | 'recuperacion' | 'otro';

/** A shelter asking for help with an animal's medical costs, apart from adoption (cases.ts in the API). */
export interface HelpCase {
  id: string;
  species: Species;
  name: string;
  need: HelpNeed;
  /** The estimate, from the vet's quote, as the shelter gave it. */
  costDop: number | null;
  shelter: { id: string; name: string };
  place: { name: string; municipality: string };
  photo: { url: string | null; thumb: string | null; focus: string };
  publishedAt: string | null;
  /** Published, or the latest news. */
  activeAt: string | null;
}

export interface HelpCaseDetail extends Omit<HelpCase, 'shelter'> {
  story: string;
  alsoNeeded: string | null;
  photos: { url: string | null; focus: string }[];
  updates: { id: string; body: string; at: string }[];
  shelter: { id: string; name: string; description: string | null; donation: Donation | null };
  /** The same animal's adoption profile, while adopters can see it. */
  pet: { id: string; name: string } | null;
}

/** A lost and found post (lostfound.ts in the API): an animal someone lost, or one found in the street. */
export type LostKind = 'perdido' | 'encontrado';
export interface LostPost {
  id: string;
  kind: LostKind;
  species: Species;
  name: string | null;
  sex: Sex | null;
  /** When it was lost or seen (YYYY-MM-DD). */
  seenOn: string;
  /** Where it was lost or seen. */
  place: Place;
  shelter: { id: string; name: string };
  photo: { url: string | null; thumb: string | null; focus: string };
  publishedAt: string | null;
  activeAt: string | null;
}
export interface LostPostDetail extends Omit<LostPost, 'shelter'> {
  description: string;
  photos: { url: string | null; focus: string }[];
  /** People who respond call the shelter, never the owner or the finder. */
  shelter: { id: string; name: string; phone: string };
}
/** What an old link to a post that ended (or lapsed: 30 days without renewal) still shows. */
export interface GonePost extends Omit<LostPost, 'seenOn' | 'publishedAt' | 'activeAt'> {
  status: 'home' | 'closed' | 'expired';
}

/** What an old link to a case that ended (or is paused: no news in 60 days) still shows. */
export interface GoneCase {
  id: string;
  name: string;
  species: Species;
  photo: HelpCase['photo'];
  shelter: { id: string; name: string };
  status: 'resolved' | 'closed' | 'paused';
  outcome: string | null;
  endedAt: string | null;
}

/** API compatibility keys for each companion filter. */
/** The slider's last stop, "Todo el país": a distance no one in the Dominican Republic is beyond. */
export const RADIUS_ANY = 1000;

export const companionKey: Record<Companion, 'kids' | 'dogs' | 'cats'> = { ninos: 'kids', perros: 'dogs', gatos: 'cats' };

const FRAMES: FrameColor[] = ['hoja', 'mango', 'anil', 'turquesa'];
/** Each pet keeps the same painted frame everywhere, derived from its id. */
export function frameFor(id: string): FrameColor {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return FRAMES[h % FRAMES.length];
}

export function ageMonths(birthDate: string | null): number | null {
  if (!birthDate) return null;
  const ms = Date.now() - new Date(`${birthDate}T12:00:00`).getTime();
  return Math.max(0, Math.floor(ms / (30.44 * 24 * 60 * 60 * 1000)));
}

export function ageGroup(months: number | null): AgeGroup | null {
  if (months === null) return null;
  if (months < 12) return 'cachorro';
  if (months < 36) return 'joven';
  if (months < 84) return 'adulto';
  return 'mayor';
}

/** The public contact address (brand.ts): for mailto links. In text, strings say {contact}. */
export const CONTACT_EMAIL = BRAND.contactEmail;
/** A build on sample data (local development, and staging's build sets VITE_DEMO): shows the "Demo" tag and
 *  the "Datos de ejemplo… ficticios" note. Production never sets it, so real shelters are never called
 *  fictional; a forgotten flag only hides the labels on staging. */
export const DEMO = import.meta.env.DEV || import.meta.env.VITE_DEMO === '1';
