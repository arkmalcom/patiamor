import type { Context } from 'hono';
import type { AppContext } from './env';
import { cachedProfile } from './pets';

// Link previews (PAT-32). WhatsApp, Facebook, Instagram and the like read a page's meta tags without
// running its script, so for /mascota/<id> the Worker writes the animal's name, a line about it and its
// main photo into the app's HTML. People get the same app as on any other path. An animal that went
// home or was withdrawn previews as such; an unknown id gets the app's default tags.

type C = Context<AppContext>;
type Photo = { url: string | null; thumb: string | null };
type Pet = {
  name: string; species: string; status: string; photo: Photo;
  sex?: string; birthDate?: string | null; birthDateEstimated?: boolean;
  place?: { name: string; municipality: string }; lister?: { type: string; name?: string | null };
};

const SPECIES: Record<string, [string, string]> = { perro: ['Perro', 'Perra'], gato: ['Gato', 'Gata'] };

/** "4 años", "unos 6 meses", "cerca de 1 año". */
function age(birthDate: string, estimated: boolean) {
  const [y, m, d] = birthDate.split('-').map(Number);
  const now = new Date();
  const months = (now.getUTCFullYear() - y) * 12 + (now.getUTCMonth() + 1 - m) - (now.getUTCDate() < d ? 1 : 0);
  const [n, one, many] = months < 12 ? [months, 'mes', 'meses'] : [Math.floor(months / 12), 'año', 'años'];
  const text = `${n} ${n === 1 ? one : many}`;
  return !estimated ? text : n === 1 ? `cerca de ${text}` : `unos ${text}`;
}

const escape = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

/** What the preview says, or null to leave the app's default tags. */
function card(body: { pet?: Pet; error?: string }): { title: string; description: string; photo: Photo } | null {
  const pet = body.pet;
  if (!pet) return null;
  const more = 'Hay más perros y gatos esperando familia cerca de ti en Patiamor.';
  if (pet.status === 'adopted') return { title: `¡${pet.name} ya encontró hogar!`, description: more, photo: pet.photo };
  if (pet.status === 'withdrawn') return { title: `${pet.name} ya no está disponible`, description: more, photo: pet.photo };
  const kind = (SPECIES[pet.species] ?? SPECIES.perro)[pet.sex === 'hembra' ? 1 : 0];
  const bits = [kind, pet.birthDate ? age(pet.birthDate, !!pet.birthDateEstimated) : null, pet.place ? `${pet.place.name}, ${pet.place.municipality}` : null,
    pet.lister?.type === 'shelter' ? pet.lister.name : 'Particular'];
  return { title: `${pet.name} busca familia`, description: bits.filter(Boolean).join(' · '), photo: pet.photo };
}

export async function petPage(c: C) {
  const origin = new URL(c.req.url).origin;
  const page = await c.env.ASSETS.fetch(new Request(`${origin}/`));
  const id = c.req.param('id') ?? '';
  const about = card(await cachedProfile(c, id).catch(() => ({})));
  if (!about) return page;

  // The thumbnail (about 480 px, tens of KB) suits previews best: WhatsApp skips large images. Sample
  // photos have none, so they use the full one.
  const photo = about.photo.thumb ?? about.photo.url;
  const url = `${c.env.APP_ORIGIN || origin}/mascota/${encodeURIComponent(id)}`;
  const meta = (key: 'property' | 'name', name: string, content: string) => `<meta ${key}="${name}" content="${escape(content)}" />`;
  const tags = [
    meta('property', 'og:type', 'website'),
    meta('property', 'og:site_name', 'Patiamor'),
    meta('property', 'og:locale', 'es_DO'),
    meta('property', 'og:title', about.title),
    meta('property', 'og:description', about.description),
    meta('property', 'og:url', url),
    ...(photo ? [meta('property', 'og:image', new URL(photo, origin).href), meta('property', 'og:image:alt', about.title)] : []),
    meta('name', 'twitter:card', photo ? 'summary_large_image' : 'summary'),
  ].join('');

  const out = new HTMLRewriter()
    .on('title', { element: (e) => void e.setInnerContent(`${about.title} · Patiamor`) })
    .on('meta[name="description"]', { element: (e) => void e.setAttribute('content', about.description) })
    .on('meta[property^="og:"]', { element: (e) => void e.remove() }) // the defaults, replaced below
    .on('head', { element: (e) => void e.append(tags, { html: true }) })
    .transform(page);
  const res = new Response(out.body, out);
  // The body is no longer index.html's, so its validators don't apply.
  res.headers.delete('etag');
  res.headers.delete('content-length');
  return res;
}
