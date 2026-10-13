import { Eye, EyeOff, Handshake, HeartHandshake, PencilLine, Plus, type IconNode } from 'lucide';
import { api, ApiError, type Listing, type ListingShelter, type ListingSummary, type PetForm, type PetStatus } from '../api';
import { ageMonths, type PetSummary } from '../data';
import { $, $$, html, icon, mount, type Raw } from '../dom';
import { t, type Key } from '../i18n';
import { placePet } from '../store';
import { age, canvas, miniFrame } from '../ui/canvas';
import { toast } from '../ui/toast';

// A shelter's animals in the portal (PAT-8): the list at #/refugio/<id>/animales, and the form at
// …/animales/nuevo or …/animales/<petId>. Any shelter that isn't suspended can prepare drafts; verified
// shelters publish, and a published animal reaches adopters at once. Photos arrive with PAT-9.

const STATUS_ICON: Record<PetStatus, IconNode> = {
  draft: PencilLine,
  in_review: PencilLine,
  available: Eye,
  reserved: Handshake,
  adopted: HeartHandshake,
  withdrawn: EyeOff,
};
const petChip = (s: PetStatus) => html`<span class="status-chip status-chip--pet-${s}">${icon(STATUS_ICON[s], 16)}${t(`listing.status.${s}`)}</span>`;

const notFound = (root: HTMLElement) =>
  mount(root, html`<section class="portal"><p class="loading-note" role="alert">${t('listing.notFound')}</p><a class="button button--outline" href="#/refugio">${t('portal.back')}</a></section>`);

// ---------- The shelter's animals ----------

export async function renderListings(root: HTMLElement, shelterId: string) {
  mount(root, html`<p class="loading-note" role="status">${t('portal.loading')}</p>`);
  let shelter: ListingShelter;
  let pets: ListingSummary[];
  try {
    ({ shelter, pets } = await api.shelterPets(shelterId));
  } catch {
    return notFound(root);
  }
  const base = `#/refugio/${encodeURIComponent(shelter.id)}/animales`;
  const canAdd = shelter.status !== 'suspended';
  mount(
    root,
    html`
      <section class="portal" aria-labelledby="portal-title">
        <a class="text-button portal__back" href="#/refugio">${t('portal.back')}</a>
        <div class="listings__head">
          <h1 class="page-title" id="portal-title" tabindex="-1" data-focus>${t('listing.title')}</h1>
          <p class="portal__who">${shelter.name}</p>
        </div>
        ${shelter.status === 'verified' ? '' : html`<p class="portal-card__reason">${t(shelter.status === 'suspended' ? 'listing.suspendedNote' : 'listing.unverifiedNote')}</p>`}
        ${canAdd ? html`<a class="button button--primary portal__new" href="${base}/nuevo">${icon(Plus, 20)}${t('listing.add')}</a>` : ''}
        ${pets.length
          ? html`<ul class="listings">${pets.map((p) => row(p, base))}</ul>`
          : html`<p class="passed__empty">${t('listing.empty')}</p>`}
      </section>`,
  );
}

function row(p: ListingSummary, base: string): Raw {
  const bits = [t(`listing.species.${p.species}`), t(`sex.${p.sex}`), age(p)];
  return html`
    <li>
      <a class="listing-row" href="${base}/${encodeURIComponent(p.id)}" aria-label="${t('listing.editPet', { name: p.name })}">
        ${miniFrame(p, 'sm')}
        <span class="listing-row__text">
          <strong class="listing-row__name">${p.name}</strong>
          <span class="listing-row__meta">${bits.join(' · ')}</span>
          ${p.openRequests ? html`<span class="listing-row__meta">${t(p.openRequests === 1 ? 'listing.requests1' : 'listing.requestsN', { n: p.openRequests })}</span>` : ''}
        </span>
        ${petChip(p.status)}
      </a>
    </li>`;
}

// ---------- The form ----------

export async function renderListingForm(root: HTMLElement, shelterId: string, petId: string | null) {
  mount(root, html`<p class="loading-note" role="status">${t('portal.loading')}</p>`);
  try {
    if (petId) {
      const { shelter, pet } = await api.listing(petId);
      if (shelter.id !== shelterId) throw new ApiError('not_found', {});
      form(root, shelter, pet);
    } else {
      const { shelter } = await api.shelterPets(shelterId);
      if (shelter.status === 'suspended') throw new ApiError('not_found', {});
      form(root, shelter, null);
    }
  } catch {
    notFound(root);
  }
}

const BLANK: PetForm = {
  species: 'perro',
  name: '',
  sex: 'hembra',
  birthDate: '',
  birthDateEstimated: true,
  size: 'mediano',
  energy: 'media',
  goodWith: { kids: null, dogs: null, cats: null },
  health: { vaccinated: false, sterilized: false, dewormed: false },
  story: '',
  needs: [],
  adoptionFeeDop: null,
  inCareSince: null,
};

const today = () => new Date().toISOString().slice(0, 10);
/** The first of the month, `months` back: close enough for an estimated age, and never in the future. */
function monthsAgo(months: number): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - months);
  return d.toISOString().slice(0, 10);
}

const ERRORS = [
  'invalid_species', 'invalid_name', 'invalid_sex', 'invalid_birth_date', 'invalid_size', 'invalid_energy', 'invalid_fee',
  'invalid_in_care_since', 'shelter_not_verified', 'too_young', 'story_required', 'shelter_suspended',
] as const;

function form(root: HTMLElement, shelter: ListingShelter, existing: Listing | null) {
  const v: PetForm = existing ? { ...BLANK, ...existing } : { ...BLANK };
  const months = ageMonths(v.birthDate || null);
  const draft = !existing || existing.status === 'draft';
  const canPublish = shelter.status === 'verified';
  const list = `#/refugio/${encodeURIComponent(shelter.id)}/animales`;

  const choice = (name: string, legend: string, options: [string, string][], value: string, wrap = false) => html`
    <fieldset class="question">
      <legend>${legend}</legend>
      <div class="segmented${wrap ? ' segmented--wrap' : ''}${options.length === 3 ? ' segmented--three' : ''}">
        ${options.map(([val, label]) => html`<label><input type="radio" name="${name}" value="${val}" ${val === value ? 'checked' : ''} /><span>${label}</span></label>`)}
      </div>
    </fieldset>`;
  const check = (name: string, label: Key, on: boolean) => html`<label class="check"><input type="checkbox" name="${name}" ${on ? 'checked' : ''} /><span>${t(label)}</span></label>`;

  mount(
    root,
    html`
      <section class="portal portal--listing" aria-labelledby="portal-title">
        <a class="text-button portal__back" href="${list}">${t('listing.back')}</a>
        <h1 class="page-title" id="portal-title" tabindex="-1" data-focus>${existing ? existing.name : t('listing.newTitle')}</h1>
        ${existing ? html`<p class="listing-status">${petChip(existing.status)}${existing.status === 'available' ? html`<a class="text-button" href="#/mascota/${encodeURIComponent(existing.id)}">${t('listing.viewLive')}</a>` : ''}</p>` : ''}
        <form class="portal-form listing-form" id="pet-form" novalidate>
          <div class="listing-form__fields">
            <fieldset class="form-section">
              <legend class="section-title">${t('listing.basics')}</legend>
              ${choice('species', t('listing.speciesLabel'), [['perro', t('listing.species.perro')], ['gato', t('listing.species.gato')]], v.species)}
              <label class="field">
                <span class="field__label">${t('listing.name')}</span>
                <input class="field__input" name="name" maxlength="40" value="${v.name}" autocomplete="off" />
              </label>
              ${choice('sex', t('fact.sex'), [['hembra', t('sex.hembra')], ['macho', t('sex.macho')]], v.sex)}
              <fieldset class="question">
                <legend>${t('fact.age')}</legend>
                <div class="segmented">
                  <label><input type="radio" name="ageMode" value="aprox" ${v.birthDateEstimated ? 'checked' : ''} /><span>${t('listing.ageApprox')}</span></label>
                  <label><input type="radio" name="ageMode" value="exacta" ${v.birthDateEstimated ? '' : 'checked'} /><span>${t('listing.ageExact')}</span></label>
                </div>
                <div class="age-approx" data-age="aprox" ${v.birthDateEstimated ? '' : 'hidden'}>
                  <label class="field"><span class="field__label">${t('listing.years')}</span><input class="field__input" name="years" type="number" inputmode="numeric" min="0" max="30" value="${months === null ? '' : Math.floor(months / 12)}" /></label>
                  <label class="field"><span class="field__label">${t('listing.months')}</span><input class="field__input" name="months" type="number" inputmode="numeric" min="0" max="11" value="${months === null ? '' : months % 12}" /></label>
                </div>
                <label class="field" data-age="exacta" ${v.birthDateEstimated ? 'hidden' : ''}>
                  <span class="field__label">${t('listing.birthDate')}</span>
                  <input class="field__input" name="birthDate" type="date" max="${today()}" value="${v.birthDateEstimated ? '' : v.birthDate}" />
                </label>
                <p class="field__hint">${t('listing.ageHint')}</p>
              </fieldset>
              ${choice('size', t('fact.size'), [['pequeno', t('size.pequeno')], ['mediano', t('size.mediano')], ['grande', t('size.grande')]], v.size)}
              ${choice('energy', t('fact.energy'), [['tranquila', t('energy.tranquila')], ['media', t('energy.media')], ['alta', t('energy.alta')]], v.energy)}
            </fieldset>

            <fieldset class="form-section">
              <legend class="section-title">${t('compat.label')}</legend>
              <p class="muted">${t('listing.compatNote')}</p>
              ${triQuestion('kids', t('listing.withKids'), v.goodWith.kids)}
              <div data-companions>${companionQuestions(v)}</div>
            </fieldset>

            <fieldset class="form-section">
              <legend class="section-title">${t('profile.health')}</legend>
              <div class="checks">
                ${check('vaccinated', 'listing.vaccinated', v.health.vaccinated)}
                ${check('sterilized', 'listing.sterilized', v.health.sterilized)}
                ${check('dewormed', 'listing.dewormed', v.health.dewormed)}
              </div>
            </fieldset>

            <fieldset class="form-section">
              <legend class="section-title">${t('profile.story')}</legend>
              <label class="field">
                <span class="field__label">${t('listing.story')}</span>
                <textarea class="field__input field__input--area" name="story" rows="5" maxlength="2000">${v.story}</textarea>
                <span class="field__hint">${t('listing.storyHint')}</span>
              </label>
              <label class="field">
                <span class="field__label">${t('profile.needs')} <span class="muted">(${t('request.optional')})</span></span>
                <textarea class="field__input field__input--area" name="needs" rows="3" maxlength="420">${v.needs.join('\n')}</textarea>
                <span class="field__hint">${t('listing.needsHint')}</span>
              </label>
              <label class="field">
                <span class="field__label">${t('profile.fee')} <span class="muted">(${t('request.optional')})</span></span>
                <span class="money"><span class="money__unit" aria-hidden="true">RD$</span><input class="field__input" name="fee" type="number" inputmode="numeric" min="0" max="50000" step="1" value="${v.adoptionFeeDop ?? ''}" aria-describedby="fee-hint" /></span>
                <span class="field__hint" id="fee-hint">${t('listing.feeHint')}</span>
              </label>
              <label class="field">
                <span class="field__label">${t('listing.inCareSince')} <span class="muted">(${t('request.optional')})</span></span>
                <input class="field__input" name="inCareSince" type="date" max="${today()}" value="${v.inCareSince ?? ''}" />
              </label>
            </fieldset>
          </div>

          <aside class="listing-preview" aria-labelledby="preview-title">
            <h2 class="form-subsection__title" id="preview-title">${t('listing.preview')}</h2>
            <div class="listing-preview__card" data-preview aria-hidden="true"></div>
            <p class="muted listing-preview__note">${t('listing.photosSoon')}</p>
          </aside>

          <div class="listing-form__actions">
            ${draft && !canPublish ? html`<p class="muted">${t('listing.publishLater')}</p>` : ''}
            <p class="form-error" role="alert" hidden data-error></p>
            <div class="listing-form__buttons">
              ${draft
                ? html`
                    ${canPublish ? html`<button class="button button--primary" type="submit" value="publish" data-send>${t('listing.publish')}</button>` : ''}
                    <button class="button ${canPublish ? 'button--outline' : 'button--primary'}" type="submit" value="draft" data-send>${t('listing.saveDraft')}</button>`
                : html`<button class="button button--primary" type="submit" value="save" data-send>${t('listing.save')}</button>`}
            </div>
          </div>
        </form>
      </section>`,
  );

  const formEl = $<HTMLFormElement>('#pet-form', root);
  const error = $('[data-error]', root);

  /** The form's current values, in the API's shape. */
  const read = (): PetForm => {
    const f = new FormData(formEl);
    const s = (k: string) => String(f.get(k) ?? '').trim();
    const triVal = (k: string) => (s(k) === 'si' ? true : s(k) === 'no' ? false : null);
    const estimated = s('ageMode') !== 'exacta';
    const years = Number(s('years') || 0);
    const months = Number(s('months') || 0);
    const hasAge = s('years') !== '' || s('months') !== '';
    return {
      species: s('species') as PetForm['species'],
      name: s('name'),
      sex: s('sex') as PetForm['sex'],
      birthDate: estimated ? (hasAge ? monthsAgo(Math.max(0, years * 12 + months)) : '') : s('birthDate'),
      birthDateEstimated: estimated,
      size: s('size') as PetForm['size'],
      energy: s('energy') as PetForm['energy'],
      goodWith: { kids: triVal('kids'), dogs: triVal('dogs'), cats: triVal('cats') },
      health: { vaccinated: f.get('vaccinated') === 'on', sterilized: f.get('sterilized') === 'on', dewormed: f.get('dewormed') === 'on' },
      story: s('story'),
      needs: s('needs').split('\n').map((n) => n.trim()).filter(Boolean),
      adoptionFeeDop: s('fee') === '' ? null : Number(s('fee')),
      inCareSince: s('inCareSince') || null,
    };
  };

  // The card adopters will see, redrawn as the form changes.
  const preview = $('[data-preview]', root);
  const draw = () => {
    const p = read();
    const pet: PetSummary = {
      id: existing?.id ?? 'nuevo',
      species: p.species,
      name: p.name || t('listing.namePlaceholder'),
      sex: p.sex,
      birthDate: p.birthDate || null,
      birthDateEstimated: p.birthDateEstimated,
      size: p.size,
      energy: p.energy,
      goodWith: p.goodWith,
      health: p.health,
      litterId: null,
      status: 'available',
      requests: 'open',
      place: shelter.place ?? { id: '', name: '', municipality: '', province: '', lat: 18.47, lng: -69.9 },
      lister: { type: 'shelter', id: shelter.id, name: shelter.name },
      photo: { url: null, focus: '50% 40%' },
    };
    mount(preview, canvas(placePet(pet), { loading: 'lazy' }));
  };

  let species = v.species;
  formEl.addEventListener('change', (e) => {
    const el = e.target as HTMLInputElement;
    if (el.name === 'ageMode') $$<HTMLElement>('[data-age]', root).forEach((b) => (b.hidden = b.dataset.age !== el.value));
    // "Otros perros" for a dog, "Perros" for a cat: the companion questions follow the species.
    if (el.name === 'species' && el.value !== species) {
      species = el.value as PetForm['species'];
      const now = read();
      mount($('[data-companions]', root), companionQuestions({ ...now, species }));
    }
    draw();
  });
  formEl.addEventListener('input', draw);
  draw();

  formEl.addEventListener('submit', async (e) => {
    e.preventDefault();
    const action = ((e as SubmitEvent).submitter as HTMLButtonElement | null)?.value ?? 'save';
    const body = read();
    // The two checks the server can't word for the person: no age yet, or an unfinished name.
    const local = !body.name ? 'invalid_name' : !body.birthDate ? 'invalid_birth_date' : null;
    const buttons = $$<HTMLButtonElement>('[data-send]', root);
    const fail = (code: string) => {
      error.textContent = (ERRORS as readonly string[]).includes(code) ? t(`listing.err.${code as (typeof ERRORS)[number]}`) : t('auth.err.network');
      error.hidden = false;
      error.scrollIntoView({ block: 'center', behavior: 'smooth' });
      buttons.forEach((b) => (b.disabled = false));
    };
    error.hidden = true;
    if (local) return fail(local);
    buttons.forEach((b) => (b.disabled = true));
    try {
      const publish = action === 'publish';
      const saved = existing ? await api.savePet(existing.id, body, publish) : await api.createPet(shelter.id, body, publish);
      toast(t(publish ? 'listing.published' : saved.status === 'draft' ? 'listing.savedDraft' : 'listing.saved', { name: body.name }));
      location.hash = list.slice(1);
    } catch (err) {
      fail(err instanceof ApiError ? err.code : 'network');
    }
  });
}

/** Sí / No / Por confirmar: null is "they haven't tried it yet". */
function triQuestion(name: string, legend: string, value: boolean | null): Raw {
  const current = value === true ? 'si' : value === false ? 'no' : 'nose';
  const options: [string, Key][] = [['si', 'listing.yes'], ['no', 'listing.no'], ['nose', 'listing.unknown']];
  return html`
    <fieldset class="question">
      <legend>${legend}</legend>
      <div class="segmented segmented--three">
        ${options.map(([val, l]) => html`<label><input type="radio" name="${name}" value="${val}" ${val === current ? 'checked' : ''} /><span>${t(l)}</span></label>`)}
      </div>
    </fieldset>`;
}

/** The two companion questions, worded for the species ("¿Con otros perros?" for a dog, "¿Con perros?" for a cat). */
function companionQuestions(v: PetForm): Raw {
  const who = (c: 'perros' | 'gatos') => (v.species === 'gato' ? t(`companion.${c}.forCat`) : t(`companion.${c}`)).toLowerCase();
  return html`${triQuestion('dogs', t('listing.withCompanion', { who: who('perros') }), v.goodWith.dogs)}${triQuestion('cats', t('listing.withCompanion', { who: who('gatos') }), v.goodWith.cats)}`;
}

