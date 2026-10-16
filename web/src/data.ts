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

export interface PetDetail extends PetSummary {
  story: string;
  needs: string[];
  inCareSince: string | null;
  adoptionFeeDop: number | null;
  photos: { url: string | null; focus: string }[];
  lister:
    | { type: 'shelter'; id: string; name: string; description: string | null; place: string | null; municipality: string | null; visitHours: string | null }
    | { type: 'private' };
  siblings: PetSummary[];
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
