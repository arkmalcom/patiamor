import { ArrowLeft, HandHeart, HeartPulse, House, Share2 } from 'lucide';
import { api, ApiError } from '../api';
import { DEMO, frameFor, type GoneCase, type HelpCase, type HelpCaseDetail, type PetSummary } from '../data';
import { $, html, icon, mount, type Raw } from '../dom';
import { formatDate, pesos, t } from '../i18n';
import { setPage, titled } from '../seo';
import { photo } from '../ui/canvas';
import { shareCase } from '../ui/share';
import { toast } from '../ui/toast';
import { bindCopyAccounts, donation } from './profile';

// Help cases (owner decision, 2026-10-28): animals verified shelters need help with (surgery, treatment,
// exams), apart from adoption. The list at /ayudar and each case at /caso/<id>. People give straight to the
// shelter's accounts; Patiamor never touches the money. A list, not the deck: nobody swipes past a sick animal.

let list: HelpCase[] | null = null;
let listStatus: 'idle' | 'loading' | 'error' = 'idle';
const details = new Map<string, HelpCaseDetail>();
const ended = new Map<string, GoneCase>();
const missing = new Set<string>();
const loading = new Set<string>();

/** Redraws only while the person is still on the page that asked. */
const redrawIf = (path: string, draw: () => void) => () => location.pathname === path && draw();

const coverOf = (k: { id: string; photo: HelpCase['photo'] }) => photo({ id: k.id, photo: k.photo } as PetSummary, 'lazy', true);
const dateOf = (iso: string | null) => (iso ? formatDate(iso.slice(0, 10)) : '');

function card(k: HelpCase): Raw {
  return html`
    <li>
      <a class="result help-card" href="/caso/${encodeURIComponent(k.id)}">
        <span class="mini-frame mini-frame--md" data-frame="${frameFor(k.id)}">${coverOf(k)}</span>
        <span class="result__text">
          <strong class="result__name">${k.name}</strong>
          <span class="help-card__need">${icon(HeartPulse, 16)}${t(`help.need.${k.need}`)}</span>
          ${k.costDop ? html`<span class="result__bits">${t('help.cost', { amount: pesos(k.costDop) })}</span>` : ''}
          <span class="result__where"><span class="lister">${k.shelter.name}</span><span>${k.place.name}, ${k.place.municipality}</span></span>
          <span class="help-card__when">${k.activeAt && k.activeAt !== k.publishedAt ? t('help.updatedOn', { date: dateOf(k.activeAt) }) : t('help.publishedOn', { date: dateOf(k.publishedAt) })}</span>
        </span>
      </a>
    </li>`;
}

export function renderHelp(root: HTMLElement) {
  const draw = redrawIf('/ayudar', () => renderHelp(root));
  if (!list && listStatus === 'idle') {
    listStatus = 'loading';
    api
      .helpCases()
      .then((cases) => ((list = cases), (listStatus = 'idle')))
      .catch(() => (listStatus = 'error'))
      .finally(draw);
  }
  const body = list
    ? list.length
      ? html`<ul class="results help__list">${list.map(card)}</ul>`
      : html`<p class="passed__empty">${t('help.empty')}</p>`
    : listStatus === 'error'
      ? html`<div class="search__failed" role="alert"><p>${t('help.error')}</p><button class="button button--outline button--small" type="button" data-retry>${t('help.retry')}</button></div>`
      : html`<p class="loading-note" role="status">${t('help.loading')}</p>`;
  mount(
    root,
    html`
      <section class="help" aria-labelledby="help-title">
        <h1 class="page-title" id="help-title" tabindex="-1" data-focus>${t('help.title')}</h1>
        <p class="help__lede">${t('help.lede')}</p>
        ${body}
        ${DEMO ? html`<p class="sample-note">${t('app.sampleNote')}</p>` : ''}
      </section>`,
  );
  root.querySelector('[data-retry]')?.addEventListener('click', () => ((listStatus = 'idle'), renderHelp(root)));
}

/** The case's photos, side by side to swipe through, each in an arched frame. */
function photos(k: HelpCaseDetail): Raw {
  const shown = k.photos.length ? k.photos : [{ url: null, focus: '50% 40%' }];
  return html`
    <div class="case__photos" ${shown.length > 1 ? html`tabindex="0" aria-label="${t('listing.photos')}"` : ''}>
      ${shown.map(
        (p, i) => html`<span class="case__photo" data-frame="${frameFor(k.id)}">${photo({ id: k.id, photo: { url: p.url, focus: p.focus } } as PetSummary, i ? 'lazy' : 'eager', false, i ? '' : k.name)}</span>`,
      )}
    </div>`;
}

function page(k: HelpCaseDetail): Raw {
  return html`
    <article class="case" aria-labelledby="case-name">
      <div class="case__bar">
        <button class="icon-button icon-button--float" type="button" data-back aria-label="${t('help.back')}">${icon(ArrowLeft, 22)}</button>
        <button class="icon-button icon-button--float" type="button" data-share aria-label="${t('help.share', { name: k.name })}">${icon(Share2, 22)}</button>
      </div>
      ${photos(k)}
      <div class="profile__body case__body">
        <header class="case__head">
          <h1 class="page-title" id="case-name" tabindex="-1" data-focus>${k.name}</h1>
          <p class="help-card__need case__need">${icon(HeartPulse, 18)}${t(`help.need.${k.need}`)}</p>
          ${k.costDop
            ? html`<p class="case__cost"><strong>${t('help.cost', { amount: pesos(k.costDop) })}</strong><span class="muted">${t('help.costNote')}</span></p>`
            : ''}
          <a class="button button--primary case__give" href="#como-ayudar">${icon(HandHeart, 20)}${t('help.how')}</a>
        </header>
        <section class="profile__section"><h2 class="section-title">${t('help.story')}</h2><p class="profile__story">${k.story}</p></section>
        ${k.alsoNeeded ? html`<section class="profile__section"><h2 class="section-title">${t('help.alsoNeeded')}</h2><p>${k.alsoNeeded}</p></section>` : ''}
        ${k.updates.length
          ? html`<section class="profile__section">
              <h2 class="section-title">${t('help.updates')}</h2>
              <ol class="case-updates">${k.updates.map((u) => html`<li><time datetime="${u.at}">${dateOf(u.at)}</time><p>${u.body}</p></li>`)}</ol>
            </section>`
          : ''}
        <section class="profile__section case__how" id="como-ayudar" tabindex="-1">
          <h2 class="section-title">${t('help.how')}</h2>
          ${k.shelter.donation ? donation(k.shelter.name, k.shelter.donation, true) : ''}
          <p class="case__concept">${t('help.concept', { name: k.name })}</p>
        </section>
        ${k.pet
          ? html`<p class="help-banner">${icon(House, 20)}<span>${t('help.adopt', { name: k.pet.name })} <a href="/mascota/${encodeURIComponent(k.pet.id)}">${t('help.adoptLink')}</a></span></p>`
          : ''}
        <section class="profile__section">
          <h2 class="section-title">${t('help.who')}</h2>
          <div class="shelter__card">
            <span class="shelter__mark" aria-hidden="true">${icon(House, 22)}</span>
            <div>
              <p class="shelter__name">${k.shelter.name}</p>
              <p class="muted">${k.place.name}, ${k.place.municipality}</p>
              ${k.shelter.description ? html`<p class="shelter__meta">${k.shelter.description}</p>` : ''}
            </div>
          </div>
          ${DEMO ? html`<p class="sample-note">${t('app.sampleNote')}</p>` : ''}
        </section>
      </div>
    </article>`;
}

/** An old link to a case that ended (with what happened) or is paused. */
function gonePage(k: GoneCase): Raw {
  return html`
    <section class="profile-missing profile-gone">
      <span class="mini-frame profile-gone__frame" data-frame="${frameFor(k.id)}">${photo({ id: k.id, photo: k.photo } as PetSummary, 'eager')}</span>
      <h1 class="page-title" tabindex="-1" data-focus>${t(`help.gone.${k.status}`, { name: k.name })}</h1>
      ${k.outcome
        ? html`<p class="muted">${t('help.gone.from', { shelter: k.shelter.name })}</p><blockquote class="case__outcome">${k.outcome}</blockquote>`
        : html`<p class="muted">${t('help.gone.pausedBody', { shelter: k.shelter.name })}</p>`}
      <a class="button button--primary" href="/ayudar">${icon(HandHeart, 18)}${t('help.gone.more')}</a>
    </section>`;
}

export function renderCase(root: HTMLElement, id: string, deps: { back: () => void }) {
  const path = `/caso/${encodeURIComponent(id)}`;
  const draw = redrawIf(path, () => renderCase(root, id, deps));
  const k = details.get(id);
  if (!k && !ended.has(id) && !missing.has(id) && !loading.has(id)) {
    loading.add(id);
    api
      .helpCase(id)
      .then((found) => details.set(id, found))
      .catch((err) => {
        if (err instanceof ApiError && err.code === 'gone') ended.set(id, err.data.case as GoneCase);
        else if (err instanceof ApiError && err.code === 'not_found') missing.add(id);
        else toast(t('auth.err.network'));
      })
      .finally(() => (loading.delete(id), draw()));
  }
  const gone = ended.get(id);
  if (gone) {
    setPage({ title: titled(t(`help.gone.${gone.status}`, { name: gone.name })), index: false });
    return mount(root, gonePage(gone));
  }
  if (!k) {
    if (missing.has(id)) setPage({ title: titled(t('help.unavailable')), index: false });
    mount(
      root,
      missing.has(id)
        ? html`<section class="profile-missing"><h1 class="page-title" tabindex="-1" data-focus>${t('help.unavailable')}</h1>
            <p class="muted">${t('help.unavailableBody')}</p>
            <a class="button button--outline" href="/ayudar">${icon(HandHeart, 18)}${t('help.gone.more')}</a></section>`
        : html`<p class="loading-note" role="status">${t('help.loading')}</p>`,
    );
    return;
  }
  setPage({ title: titled(t('seo.case', { name: k.name })), index: true });
  mount(root, page(k));
  $('[data-back]', root).addEventListener('click', deps.back);
  $('[data-share]', root).addEventListener('click', () => void shareCase(k));
  // "Cómo ayudar" is on the same page: move there without changing the address (it's not a route).
  $('.case__give', root).addEventListener('click', (e) => {
    e.preventDefault();
    const target = $('#como-ayudar', root);
    target.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    target.focus({ preventScroll: true });
  });
  bindCopyAccounts(root);
}
