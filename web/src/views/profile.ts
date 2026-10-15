import { ArrowLeft, Check, CircleHelp, Clock, Heart, HeartHandshake, House, Mail, Send, Share2, User, X } from 'lucide';
import { api, ApiError, type GonePet } from '../api';
import { companionKey, CONTACT_EMAIL, DEMO, frameFor, type Companion, type PetDetail, type PetSummary } from '../data';
import { $, $$, html, icon, mount, type Raw } from '../dom';
import { formatDate, t, away } from '../i18n';
import { activeRequestFor, cachePets, petCache, placePet, state, takeChanged, update } from '../store';
import { alertButton, beforeYouStart, bindAlerts, listerName, startRequest } from '../ui/request';
import { age, canvas, companionLabel, photo } from '../ui/canvas';
import { bindGallery } from '../ui/gallery';
import { openReport, reportButton } from '../ui/report';
import { sharePet } from '../ui/share';
import { toast } from '../ui/toast';

interface ProfileDeps {
  back: () => void;
  openProfile: (id: string) => void;
}

const loading = new Set<string>();
const missing = new Set<string>();
/** Animals that were adopted or withdrawn: what the API still tells about them (a 410). */
const gone = new Map<string, GonePet>();
const isDetail = (d: PetSummary | PetDetail | undefined): d is PetDetail => !!d && 'story' in d;

function status(value: boolean | null, yes = t('profile.yes'), no = t('profile.no')): Raw {
  if (value === true) return html`<span class="status status--yes">${icon(Check, 16)}${yes}</span>`;
  if (value === false) return html`<span class="status status--no">${icon(X, 16)}${no}</span>`;
  return html`<span class="status status--unknown">${icon(CircleHelp, 16)}${t('profile.unknown')}</span>`;
}

/** Fetches the full profile once; the store update re-renders whatever screen is showing it. */
function fetchDetail(id: string) {
  if (loading.has(id)) return;
  loading.add(id);
  api
    .pet(id, takeChanged(id))
    .then((pet) => {
      cachePets(pet.siblings);
      petCache.set(id, pet);
    })
    .catch((err) => {
      if (err instanceof ApiError && err.code === 'gone') gone.set(id, err.data.pet as GonePet);
      else if (err instanceof ApiError && err.code === 'not_found') missing.add(id);
      else toast(t('auth.err.network'));
    })
    .finally(() => {
      loading.delete(id);
      update(() => {});
    });
}

function lister(pet: PetDetail, km: number): Raw {
  if (pet.lister.type === 'private') {
    return html`
      <div class="shelter__card">
        <span class="shelter__mark shelter__mark--private" aria-hidden="true">${icon(User, 22)}</span>
        <div>
          <p class="shelter__name">${t('lister.private')}</p>
          <p class="muted">${pet.place.name}, ${pet.place.municipality} · ${away(km)}</p>
          <p class="shelter__meta">${t('lister.privateNote')}</p>
        </div>
      </div>`;
  }
  const s = pet.lister;
  return html`
    <div class="shelter__card">
      <span class="shelter__mark" aria-hidden="true">${icon(House, 22)}</span>
      <div>
        <p class="shelter__name">${s.name}</p>
        <p class="muted">${s.place ?? pet.place.name}, ${s.municipality ?? pet.place.municipality} · ${away(km)}</p>
        ${s.visitHours ? html`<p class="shelter__meta"><strong>${t('profile.visits')}:</strong> ${s.visitHours}</p>` : ''}
        ${pet.inCareSince ? html`<p class="shelter__meta">${t('profile.inShelter', { date: formatDate(pet.inCareSince, { day: 'numeric', month: 'long', year: 'numeric' }) })}</p>` : ''}
      </div>
    </div>`;
}

function siblings(pet: PetDetail): Raw {
  if (!pet.siblings.length) return html``;
  return html`
    <section class="profile__section">
      <h2 class="section-title">${t('profile.siblings')}</h2>
      <ul class="siblings">
        ${pet.siblings.map(
          (s) => html`<li>
            <button class="sibling" type="button" data-sibling="${s.id}">
              <span class="mini-frame mini-frame--sm" data-frame="${frameFor(s.id)}">${photo(s, 'lazy', true)}</span>
              <span><strong>${s.name}</strong><span class="muted">${t(`sex.${s.sex}`)} · ${age(s)}</span></span>
            </button>
          </li>`,
        )}
      </ul>
    </section>`;
}

function body(pet: PetDetail, km: number): Raw {
  const companions: Companion[] = ['ninos', 'perros', 'gatos'];
  const health = [
    ['vacunas', pet.health.vaccinated],
    ['esterilizacion', pet.health.sterilized],
    ['desparasitacion', pet.health.dewormed],
  ] as const;
  return html`
    ${pet.story ? html`<section class="profile__section"><h2 class="section-title">${t('profile.story')}</h2><p class="profile__story">${pet.story}</p></section>` : ''}
    ${pet.needs.length ? html`<section class="profile__section"><h2 class="section-title">${t('profile.needs')}</h2><ul class="needs">${pet.needs.map((n) => html`<li>${n}</li>`)}</ul></section>` : ''}
    ${siblings(pet)}
    <div class="profile__pair">
      <section class="profile__section">
        <h2 class="section-title">${t('profile.goodWith')}</h2>
        <dl class="status-list">${companions.map((c) => html`<div><dt>${companionLabel(c, pet)}</dt><dd>${status(pet.goodWith[companionKey[c]])}</dd></div>`)}</dl>
      </section>
      <section class="profile__section">
        <h2 class="section-title">${t('profile.health')}</h2>
        <dl class="status-list">${health.map(([k, v]) => html`<div><dt>${t(`health.${k}`)}</dt><dd>${status(v, t('health.done'), t('health.pending'))}</dd></div>`)}</dl>
      </section>
    </div>
    ${pet.adoptionFeeDop !== null
      ? html`<section class="profile__section fee">
          <h2 class="section-title">${t('profile.fee')}</h2>
          <p><strong class="fee__amount">RD$${pet.adoptionFeeDop.toLocaleString('es-DO')}</strong> · ${t('profile.feeNote')}</p>
        </section>`
      : ''}
    <section class="profile__section shelter">
      <h2 class="section-title">${t('profile.lister')}</h2>
      ${lister(pet, km)}
      ${DEMO ? html`<p class="sample-note">${t('app.sampleNote')}</p>` : ''}
    </section>
    ${canStart(pet) ? ready(pet) : ''}`;
}

/** Whether this pet can take a new request from this person right now. */
const canStart = (pet: PetSummary) => pet.status === 'available' && pet.requests !== 'paused' && !activeRequestFor(pet.id);

/** The end of the profile: what to know before starting. "Quiero adoptar", always in view in the bar, starts the process. */
function ready(pet: PetDetail): Raw {
  return html`
    <section class="profile__section ready" id="ready" tabindex="-1" aria-labelledby="ready-title">
      <h2 class="section-title" id="ready-title">${t('profile.ready.title')}</h2>
      <p>${t('profile.ready.body', { lister: listerName(pet), name: pet.name })}</p>
      ${beforeYouStart(pet)}
      ${state.user?.requestsRestricted
        ? html`<div class="withdraw-warning">
            <p>${t('profile.ready.restricted')}</p>
            <a class="button button--ink button--small ready__write" href="mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(t('request.restrictedSubject'))}">${icon(Mail, 18)}${t('full.manyCta')}</a>
          </div>`
        : html`<p class="muted ready__note">${t('profile.ready.note')}</p>`}
    </section>`;
}

/** An old link (Mi lista, or one shared before) to an animal that found a home or was withdrawn. */
function renderGone(root: HTMLElement, pet: GonePet | PetSummary) {
  const adopted = pet.status === 'adopted';
  mount(
    root,
    html`<section class="profile-missing profile-gone">
      <span class="mini-frame profile-gone__frame" data-frame="${frameFor(pet.id)}">${photo({ id: pet.id, photo: pet.photo } as PetSummary, 'eager')}</span>
      <h1 class="page-title" tabindex="-1" data-focus>${t(adopted ? 'profile.gone.adopted' : 'profile.gone.withdrawn', { name: pet.name })}</h1>
      <p class="muted">${t(adopted ? 'profile.gone.adoptedBody' : 'profile.gone.withdrawnBody')}</p>
      <a class="button button--primary" href="/">${icon(adopted ? House : Heart, 18)}${t('profile.gone.explore')}</a>
    </section>`,
  );
}

export function renderProfile(root: HTMLElement, id: string, deps: ProfileDeps) {
  const cached = petCache.get(id);
  if (!isDetail(cached) && !missing.has(id) && !gone.has(id)) fetchDetail(id);
  const ended = gone.get(id) ?? (cached && (cached.status === 'adopted' || cached.status === 'withdrawn') ? cached : undefined);
  if (ended) return renderGone(root, ended);

  if (!cached) {
    mount(
      root,
      missing.has(id)
        ? html`<section class="profile-missing"><h1 class="page-title" tabindex="-1" data-focus>${t('profile.unavailable')}</h1>
            <p class="muted">${t('profile.unavailableBody')}</p>
            <button class="button button--outline" type="button" data-back>${icon(ArrowLeft, 18)}${t('profile.back')}</button></section>`
        : html`<p class="loading-note" role="status">${t('profile.loading')}</p>`,
    );
    root.querySelector('[data-back]')?.addEventListener('click', deps.back);
    return;
  }

  const p = placePet(cached);
  const pet = cached;
  const active = activeRequestFor(pet.id);
  const waiting = pet.status === 'reserved' || pet.requests === 'paused';
  // The bar follows the adoption path: "Quiero adoptar" leads to the end of the profile, where the
  // commitment lives; once sent, it points to Mi lista.
  const bar = active
    ? html`<span class="saved-tag">${icon(Send, 18)}${t('request.status.sent')}</span>
        <a class="button button--outline" href="/lista">${t('request.inList')}</a>`
    : waiting
      ? html`<span class="wait-tag">${icon(HeartHandshake, 18)}${pet.status === 'reserved' ? t('request.reservedShort') : t('request.pausedShort')}</span>
          ${state.signedIn ? alertButton(pet) : ''}`
      : html`<button class="button button--outline" type="button" data-skip>${icon(Clock, 20)}${t('deck.skip')}</button>
          ${canStart(pet) ? html`<button class="button button--primary" type="button" data-start ${isDetail(pet) ? '' : 'disabled'}>${icon(Heart, 20)}${t('deck.save')}</button>` : ''}`;
  mount(
    root,
    html`
      <article class="profile" aria-labelledby="pet-name">
        <div class="profile__media">
          <button class="icon-button icon-button--float profile__back" type="button" data-back aria-label="${t('profile.back')}">${icon(ArrowLeft, 22)}</button>
          <button class="icon-button icon-button--float profile__share" type="button" data-share aria-label="${t('share.button', { name: pet.name })}">${icon(Share2, 22)}</button>
          ${canvas(p, { heading: 'h1', photoName: 'pet-photo', gallery: 'profile' })}
        </div>
        <div class="profile__body">
          ${isDetail(pet) ? html`${body(pet, p.km)}${reportButton()}` : html`<p class="loading-note" role="status">${t('profile.loading')}</p>`}
        </div>
        <div class="profile__bar">${bar}</div>
      </article>`,
  );

  $('[data-back]', root).addEventListener('click', deps.back);
  $('[data-share]', root).addEventListener('click', () => void sharePet(pet));
  root.querySelector('[data-report]')?.addEventListener('click', () => openReport(pet));
  bindGallery($('.profile__media', root), pet, 'profile');
  root.querySelector('[data-start]')?.addEventListener('click', () => startRequest(pet.id));
  bindAlerts(root);
  root.querySelector('[data-skip]')?.addEventListener('click', () => {
    update((s) => s.skipped.push(pet.id));
    toast(t('deck.skipped', { name: pet.name }));
    deps.back();
  });
  $$<HTMLButtonElement>('[data-sibling]', root).forEach((b) => b.addEventListener('click', () => deps.openProfile(b.dataset.sibling!)));
}
