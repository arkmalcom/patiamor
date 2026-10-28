import { ArrowLeft, CalendarDays, House, MapPin, MessageCircle, PawPrint, Phone, Search, Share2 } from 'lucide';
import { api, ApiError } from '../api';
import { DEMO, frameFor, type GonePost, type LostKind, type LostPost, type LostPostDetail, type PetSummary } from '../data';
import { $, $$, html, icon, mount, type Raw } from '../dom';
import { distanceKm } from '../geo';
import { away, formatDate, sentence, t } from '../i18n';
import { setPage, titled } from '../seo';
import { state } from '../store';
import { photo } from '../ui/canvas';
import { rescueTabs } from '../ui/rescue-tabs';
import { shareLink } from '../ui/share';
import { toast } from '../ui/toast';

// Lost and found (owner decision, 2026-10-28): animals someone lost or found in the street, posted by verified
// shelters, under the Rescate tab. The list at /perdidos, nearest first, and each post at /perdidos/<id>.
// People who recognise one call or write to the shelter, never to the owner or the finder.

type Filter = 'todos' | LostKind;
const FILTERS: Filter[] = ['todos', 'perdido', 'encontrado'];
let filter: Filter = 'todos';
let list: LostPost[] | null = null;
let listStatus: 'idle' | 'loading' | 'error' = 'idle';
const details = new Map<string, LostPostDetail>();
const ended = new Map<string, GonePost>();
const missing = new Set<string>();
const loading = new Set<string>();

type Who = Pick<LostPost, 'kind' | 'species' | 'name' | 'sex'>;
/** "Perra", "Gato"… (masculine when the sex isn't known, as Spanish does). */
const animal = (l: Who) => t(`lost.animal.${l.species}.${l.sex ?? 'macho'}`);
/** "perdida", "encontrado"… */
const adjective = (l: Who) => t(`lost.adj.${l.kind}.${l.sex ?? 'macho'}`);
/** "Se busca a Bruno", or "Perra encontrada" when there's no name (or it was found). */
export const lostTitle = (l: Who) => (l.kind === 'perdido' && l.name ? t('lost.seek', { name: l.name }) : `${animal(l)} ${adjective(l)}`);
export const kindChip = (l: Who) => html`<span class="lost-chip lost-chip--${l.kind}">${sentence(adjective(l))}</span>`;

const dateOf = (iso: string) => formatDate(iso.slice(0, 10));
const kmFrom = (l: Pick<LostPost, 'place'>) => (state.location ? distanceKm(state.location, l.place) : null);
const coverOf = (l: { id: string; photo: LostPost['photo'] }, loading: 'lazy' | 'eager' = 'lazy', small = true) =>
  photo({ id: l.id, photo: l.photo } as PetSummary, loading, small);
/** "+18095550100" → "809-555-0100". */
const showPhone = (p: string) => {
  const d = p.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
  return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` : p;
};

/** Redraws only while the person is still on the page that asked. */
const redrawIf = (path: string, draw: () => void) => () => location.pathname === path && draw();

function card(l: LostPost): Raw {
  const km = kmFrom(l);
  return html`
    <li>
      <a class="result help-card" href="/perdidos/${encodeURIComponent(l.id)}">
        <span class="mini-frame mini-frame--md" data-frame="${frameFor(l.id)}">${coverOf(l)}</span>
        <span class="result__text">
          <strong class="result__name">${l.name ?? lostTitle(l)}</strong>
          ${kindChip(l)}
          <span class="result__bits">${[l.place.name, l.place.municipality].join(', ')}${km === null ? '' : ` · ${away(km)}`}</span>
          <span class="help-card__when">${dateOf(l.seenOn)} · ${l.shelter.name}</span>
        </span>
      </a>
    </li>`;
}

export function renderLost(root: HTMLElement) {
  const draw = redrawIf('/perdidos', () => renderLost(root));
  if (!list && listStatus === 'idle') {
    listStatus = 'loading';
    api
      .lostPosts()
      .then((posts) => ((list = posts), (listStatus = 'idle')))
      .catch(() => (listStatus = 'error'))
      .finally(draw);
  }
  // Nearest first: where it was lost or seen is what matters most to someone who might recognise it.
  const shown = (list ?? [])
    .filter((l) => filter === 'todos' || l.kind === filter)
    .map((l) => ({ l, km: kmFrom(l) ?? 0 }))
    .sort((a, b) => a.km - b.km)
    .map(({ l }) => l);
  const body = list
    ? shown.length
      ? html`<ul class="results help__list">${shown.map(card)}</ul>`
      : html`<p class="passed__empty">${t(list.length ? 'lost.emptyFiltered' : 'lost.empty')}</p>`
    : listStatus === 'error'
      ? html`<div class="search__failed" role="alert"><p>${t('lost.error')}</p><button class="button button--outline button--small" type="button" data-retry>${t('help.retry')}</button></div>`
      : html`<p class="loading-note" role="status">${t('lost.loading')}</p>`;
  mount(
    root,
    html`
      <section class="help" aria-labelledby="lost-title">
        ${rescueTabs('lost')}
        <h1 class="page-title" id="lost-title" tabindex="-1" data-focus>${t('lost.title')}</h1>
        <p class="help__lede">${t('lost.lede')}</p>
        <div class="segmented segmented--three lost-filter" role="radiogroup" aria-label="${t('lost.filter')}">
          ${FILTERS.map((f) => html`<label><input type="radio" name="lost-filter" value="${f}" ${f === filter ? 'checked' : ''} /><span>${t(`lost.filter.${f}`)}</span></label>`)}
        </div>
        ${body}
        ${DEMO ? html`<p class="sample-note">${t('app.sampleNote')}</p>` : ''}
      </section>`,
  );
  $$<HTMLInputElement>('input[name=lost-filter]', root).forEach((r) => r.addEventListener('change', () => ((filter = r.value as Filter), renderLost(root))));
  root.querySelector('[data-retry]')?.addEventListener('click', () => ((listStatus = 'idle'), renderLost(root)));
}

function page(l: LostPostDetail): Raw {
  const shown = l.photos.length ? l.photos : [{ url: null, focus: '50% 40%' }];
  const title = lostTitle(l);
  const km = kmFrom(l);
  const url = `${location.origin}/perdidos/${encodeURIComponent(l.id)}`;
  const digits = l.shelter.phone.replace(/\D/g, '');
  const wa = `https://wa.me/${digits.length === 10 ? `1${digits}` : digits}?text=${encodeURIComponent(t('lost.waText', { title, url }))}`;
  const row = (glyph: typeof MapPin, label: string, value: string) => html`<div><dt>${icon(glyph, 16)}${label}</dt><dd>${value}</dd></div>`;
  return html`
    <article class="case" aria-labelledby="post-title">
      <div class="case__bar">
        <button class="icon-button icon-button--float" type="button" data-back aria-label="${t('lost.back')}">${icon(ArrowLeft, 22)}</button>
        <button class="icon-button icon-button--float" type="button" data-share aria-label="${t('lost.share')}">${icon(Share2, 22)}</button>
      </div>
      <div class="case__photos" ${shown.length > 1 ? html`tabindex="0" aria-label="${t('listing.photos')}"` : ''}>
        ${shown.map((p, i) => html`<span class="case__photo" data-frame="${frameFor(l.id)}">${photo({ id: l.id, photo: { url: p.url, focus: p.focus } } as PetSummary, i ? 'lazy' : 'eager', false, i ? '' : title)}</span>`)}
      </div>
      <div class="profile__body case__body">
        <header class="case__head">
          <h1 class="page-title" id="post-title" tabindex="-1" data-focus>${title}</h1>
          ${kindChip(l)}
        </header>
        <dl class="lost-facts">
          ${row(MapPin, t('lost.where'), `${l.place.name}, ${l.place.municipality}${km === null ? '' : ` · ${away(km)}`}`)}
          ${row(CalendarDays, t('lost.when'), formatDate(l.seenOn, { day: 'numeric', month: 'long', year: 'numeric' }))}
          ${row(PawPrint, t('lost.sex'), l.sex ? t(`sex.${l.sex}`) : t('lost.unknown'))}
        </dl>
        <section class="profile__section"><h2 class="section-title">${t('lost.description')}</h2><p class="profile__story">${l.description}</p></section>
        <section class="profile__section lost-contact">
          <h2 class="section-title">${t(`lost.contact.${l.kind}`)}</h2>
          <p>${t(`lost.contactBody.${l.kind}`, { shelter: l.shelter.name })}</p>
          <div class="lost-contact__actions">
            <a class="button button--primary" href="${wa}" target="_blank" rel="noopener">${icon(MessageCircle, 20)}${t('lost.whatsapp')}</a>
            <a class="button button--outline" href="tel:${l.shelter.phone}">${icon(Phone, 20)}${t('lost.call', { phone: showPhone(l.shelter.phone) })}</a>
          </div>
        </section>
        <section class="profile__section">
          <h2 class="section-title">${t('lost.from')}</h2>
          <div class="shelter__card">
            <span class="shelter__mark" aria-hidden="true">${icon(House, 22)}</span>
            <div>
              <p class="shelter__name">${l.shelter.name}</p>
              ${l.publishedAt ? html`<p class="muted">${t('help.publishedOn', { date: dateOf(l.publishedAt) })}</p>` : ''}
            </div>
          </div>
          ${DEMO ? html`<p class="sample-note">${t('app.sampleNote')}</p>` : ''}
        </section>
      </div>
    </article>`;
}

function gonePage(l: GonePost): Raw {
  const home = l.status === 'home';
  return html`
    <section class="profile-missing profile-gone">
      <span class="mini-frame profile-gone__frame" data-frame="${frameFor(l.id)}">${coverOf(l, 'eager', false)}</span>
      <h1 class="page-title" tabindex="-1" data-focus>${home ? t('lost.gone.home', { name: l.name ?? sentence(animal(l).toLowerCase()) }) : t('lost.gone.closed')}</h1>
      <p class="muted">${home ? t('lost.gone.homeBody') : t('lost.gone.closedBody', { shelter: l.shelter.name })}</p>
      <a class="button button--primary" href="/perdidos">${icon(Search, 18)}${t('lost.gone.more')}</a>
    </section>`;
}

export function renderPost(root: HTMLElement, id: string, deps: { back: () => void }) {
  const draw = redrawIf(`/perdidos/${encodeURIComponent(id)}`, () => renderPost(root, id, deps));
  const l = details.get(id);
  if (!l && !ended.has(id) && !missing.has(id) && !loading.has(id)) {
    loading.add(id);
    api
      .lostPost(id)
      .then((found) => details.set(id, found))
      .catch((err) => {
        if (err instanceof ApiError && err.code === 'gone') ended.set(id, err.data.post as GonePost);
        else if (err instanceof ApiError && err.code === 'not_found') missing.add(id);
        else toast(t('auth.err.network'));
      })
      .finally(() => (loading.delete(id), draw()));
  }
  const gone = ended.get(id);
  if (gone) {
    setPage({ title: titled(gone.status === 'home' ? t('lost.gone.home', { name: gone.name ?? animal(gone) }) : t('lost.gone.closed')), index: false });
    return mount(root, gonePage(gone));
  }
  if (!l) {
    if (missing.has(id)) setPage({ title: titled(t('lost.unavailable')), index: false });
    mount(
      root,
      missing.has(id)
        ? html`<section class="profile-missing"><h1 class="page-title" tabindex="-1" data-focus>${t('lost.unavailable')}</h1>
            <p class="muted">${t('lost.unavailableBody')}</p>
            <a class="button button--outline" href="/perdidos">${icon(Search, 18)}${t('lost.gone.more')}</a></section>`
        : html`<p class="loading-note" role="status">${t('lost.loading')}</p>`,
    );
    return;
  }
  const title = lostTitle(l);
  setPage({ title: titled(title), index: true });
  mount(root, page(l));
  $('[data-back]', root).addEventListener('click', deps.back);
  $('[data-share]', root).addEventListener('click', () =>
    void shareLink({ title, text: t('lost.shareText', { title }), url: `${location.origin}/perdidos/${encodeURIComponent(l.id)}` }),
  );
}
