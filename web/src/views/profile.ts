import { ArrowLeft, Check, CircleHelp, Clock, Heart, House, User, X } from 'lucide';
import { api, ApiError } from '../api';
import { companionKey, frameFor, type Companion, type PetDetail, type PetSummary } from '../data';
import { $, $$, html, icon, mount, type Raw } from '../dom';
import { formatDate, t, away } from '../i18n';
import { cachePets, petCache, isSaved, placePet, state, update } from '../store';
import { age, canvas, companionLabel, photo } from '../ui/canvas';
import { removeFromList, startSave } from '../ui/save';
import { toast } from '../ui/toast';

interface ProfileDeps {
  back: () => void;
  openProfile: (id: string) => void;
}

const loading = new Set<string>();
const missing = new Set<string>();
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
    .pet(id, state.location)
    .then((pet) => {
      cachePets(pet.siblings);
      petCache.set(id, pet);
    })
    .catch((err) => {
      if (err instanceof ApiError && err.code === 'not_found') missing.add(id);
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
              <span class="mini-frame mini-frame--sm" data-frame="${frameFor(s.id)}">${photo(s)}</span>
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
      <p class="sample-note">${t('app.sampleNote')}</p>
    </section>`;
}

export function renderProfile(root: HTMLElement, id: string, deps: ProfileDeps) {
  const cached = petCache.get(id);
  if (!isDetail(cached) && !missing.has(id)) fetchDetail(id);

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
  const saved = isSaved(pet.id);
  mount(
    root,
    html`
      <article class="profile" aria-labelledby="pet-name">
        <div class="profile__media">
          <button class="icon-button icon-button--float profile__back" type="button" data-back aria-label="${t('profile.back')}">${icon(ArrowLeft, 22)}</button>
          ${canvas(p, { heading: 'h1', photoName: 'pet-photo' })}
        </div>
        <div class="profile__body">
          ${isDetail(pet) ? body(pet, p.km) : html`<p class="loading-note" role="status">${t('profile.loading')}</p>`}
        </div>
        <div class="profile__bar">
          ${saved
            ? html`<span class="saved-tag">${icon(Check, 18)}${t('profile.saved')}</span>
                <button class="button button--outline" type="button" data-remove>${t('profile.remove')}</button>`
            : html`<button class="button button--outline" type="button" data-skip>${icon(Clock, 20)}${t('deck.skip')}</button>
                <button class="button button--primary" type="button" data-save>${icon(Heart, 20)}${t('profile.save')}</button>`}
        </div>
      </article>`,
  );

  $('[data-back]', root).addEventListener('click', deps.back);
  root.querySelector('[data-save]')?.addEventListener('click', () => startSave(pet.id));
  root.querySelector('[data-remove]')?.addEventListener('click', () => removeFromList(pet.id));
  root.querySelector('[data-skip]')?.addEventListener('click', () => {
    update((s) => s.skipped.push(pet.id));
    toast(t('deck.skipped', { name: pet.name }));
    deps.back();
  });
  $$<HTMLButtonElement>('[data-sibling]', root).forEach((b) => b.addEventListener('click', () => deps.openProfile(b.dataset.sibling!)));
}
