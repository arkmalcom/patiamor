import type { Context } from 'hono';
import type { AppContext } from './env';
import { cachedCase } from './cases';
import { cachedProfile } from './pets';
import { indexable } from './seo';
import { BRAND } from '../../web/src/brand';

// Link previews (PAT-32). WhatsApp, Facebook, Instagram and the like read a page's meta tags without
// running its script, so for /mascota/<id> (and a help case's /caso/<id>) the Worker writes the animal's
// name, a line about it and its main photo into the app's HTML. People get the same app as on any other path. An animal that went
// home or was withdrawn previews as such (and is kept out of search results); an unknown id gets the app's
// default tags and a 404, so search engines don't list it as a copy of the front page.

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
function card(body: { pet?: Pet; error?: string }): About | null {
  const pet = body.pet;
  if (!pet) return null;
  const more = `Hay más perros y gatos esperando familia cerca de ti en ${BRAND.name}.`;
  if (pet.status === 'adopted') return { title: `¡${pet.name} ya encontró hogar!`, description: more, photo: pet.photo, ended: true };
  if (pet.status === 'withdrawn') return { title: `${pet.name} ya no está disponible`, description: more, photo: pet.photo, ended: true };
  const kind = (SPECIES[pet.species] ?? SPECIES.perro)[pet.sex === 'hembra' ? 1 : 0];
  const bits = [kind, pet.birthDate ? age(pet.birthDate, !!pet.birthDateEstimated) : null, pet.place ? `${pet.place.name}, ${pet.place.municipality}` : null,
    pet.lister?.type === 'shelter' ? pet.lister.name : 'Particular'];
  return { title: `${pet.name} busca familia`, description: bits.filter(Boolean).join(' · '), photo: pet.photo };
}

type Case = { name: string; need: string; costDop?: number | null; status?: string; photo: Photo; shelter: { name: string }; place?: { name: string; municipality: string } };

const NEED: Record<string, string> = {
  cirugia: 'Necesita una cirugía',
  tratamiento: 'Necesita tratamiento',
  examenes: 'Necesita exámenes',
  medicinas: 'Necesita medicinas',
  recuperacion: 'Está en recuperación',
  otro: 'Necesita ayuda',
};

/** A help case's preview. One that ended or is paused says so, without the ask. */
function caseCard(body: { case?: Case; error?: string }): About | null {
  const k = body.case;
  if (!k) return null;
  if (body.error === 'gone') {
    const title = k.status === 'resolved' ? `${k.name} recibió la ayuda que necesitaba` : k.status === 'closed' ? `El caso de ${k.name} está cerrado` : `El caso de ${k.name} no está activo ahora`;
    return { title, description: `Un caso de ${k.shelter.name} en ${BRAND.name}.`, photo: k.photo, ended: true };
  }
  const cost = k.costDop ? `costo estimado RD$${k.costDop.toLocaleString('es-DO')}` : null;
  const bits = [NEED[k.need] ?? NEED.otro, cost, k.shelter.name, k.place ? `${k.place.name}, ${k.place.municipality}` : null];
  return { title: `${k.name} necesita tu ayuda`, description: bits.filter(Boolean).join(' · '), photo: k.photo };
}

type About = { title: string; description: string; photo: Photo; ended?: true };

export async function petPage(c: C) {
  const id = c.req.param('id') ?? '';
  const profile = await cachedProfile(c, id).catch(() => ({}) as { error?: string });
  return preview(c, `/mascota/${encodeURIComponent(id)}`, card(profile), profile.error === 'not_found');
}

export async function casePage(c: C) {
  const id = c.req.param('id') ?? '';
  const found = await cachedCase(c, id).catch(() => ({}) as { error?: string });
  return preview(c, `/caso/${encodeURIComponent(id)}`, caseCard(found), found.error === 'not_found');
}

/** The app's page with these tags; with nothing to say, its default tags (and a 404 for an unknown id). */
async function preview(c: C, path: string, about: About | null, unknown: boolean) {
  const origin = new URL(c.req.url).origin;
  const page = await c.env.ASSETS.fetch(new Request(`${origin}/`));
  if (!about) return unknown ? new Response(page.body, { status: 404, headers: page.headers }) : page;

  // The thumbnail (about 480 px, tens of KB) suits previews best: WhatsApp skips large images. Sample
  // photos have none, so they use the full one.
  const photo = about.photo.thumb ?? about.photo.url;
  const url = `${c.env.APP_ORIGIN || origin}${path}`;
  const meta = (key: 'property' | 'name', name: string, content: string) => `<meta ${key}="${name}" content="${escape(content)}" />`;
  // Only open animals and cases on the real site are for search: staging, animals that went home and ended cases are not.
  const listed = indexable(c.env, origin) && !about.ended;
  const tags = [
    `<link rel="canonical" href="${escape(url)}" />`,
    ...(listed ? [] : ['<meta name="robots" content="noindex" />']),
    meta('property', 'og:type', 'website'),
    meta('property', 'og:site_name', BRAND.name),
    meta('property', 'og:locale', 'es_DO'),
    meta('property', 'og:title', about.title),
    meta('property', 'og:description', about.description),
    meta('property', 'og:url', url),
    ...(photo ? [meta('property', 'og:image', new URL(photo, origin).href), meta('property', 'og:image:alt', about.title)] : []),
    meta('name', 'twitter:card', photo ? 'summary_large_image' : 'summary'),
  ].join('');

  const out = new HTMLRewriter()
    .on('title', { element: (e) => void e.setInnerContent(`${about.title} · ${BRAND.name}`) })
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
