import { Camera, Eye, EyeOff, Handshake, HeartHandshake, PencilLine, Plus, Star, X, type IconNode } from 'lucide';
import { api, ApiError, type Listing, type ListingPhoto, type ListingShelter, type ListingSummary, type PetForm, type PetStatus } from '../api';
import { ageMonths, type PetSummary } from '../data';
import { $, $$, html, icon, mount, type Raw } from '../dom';
import { t, type Key } from '../i18n';
import { placePet } from '../store';
import { age, canvas, miniFrame } from '../ui/canvas';
import { PhotoError, preparePhoto, toBase64, type PreparedPhoto } from '../ui/photos';
import { toast } from '../ui/toast';

// A shelter's animals in the portal (PAT-8): the list at #/refugio/<id>/animales, and the form at
// …/animales/nuevo or …/animales/<petId>. Any shelter that isn't suspended can prepare drafts; verified
// shelters publish, and a published animal reaches adopters at once. Photos (PAT-9) are resized on the
// phone and sent when the form is saved, along with their order and framing.

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
  'photo_required', 'photos_full', 'upload_limit', 'storage_full', 'image_too_large', 'invalid_image', 'duplicate_photo', 'last_photo',
] as const;
const MAX_PHOTOS = 5;

/** A photo in the form: already on the server (`id`), or prepared on this phone and sent on save. */
type Item = { id?: string; url: string; thumb: string | null; focus: string; prepared?: PreparedPhoto };

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
          <div class="listing-form__layout">
          <div class="listing-form__fields">
            <fieldset class="form-section">
              <legend class="section-title">${t('listing.photos')}</legend>
              <p class="muted">${t('listing.photosNote')}</p>
              <ul class="photo-grid" data-photos></ul>
              <label class="button button--outline photo-add" data-photo-add>
                ${icon(Camera, 20)}<span>${t('listing.addPhotos')}</span>
                <input class="sr-only" type="file" accept="image/*" multiple data-photo-input />
              </label>
              <p class="field__hint" role="status" data-photo-status></p>
              <div class="photo-focus" data-focus-panel hidden>
                <p class="field__label">${t('listing.focus')}</p>
                <p class="field__hint" id="focus-hint">${t('listing.focusHint')}</p>
                <button class="photo-focus__frame" type="button" aria-describedby="focus-hint" data-focus-frame></button>
              </div>
            </fieldset>

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
          </aside>
          </div>

          <div class="listing-form__actions">
            ${draft && !canPublish ? html`<p class="muted">${t('listing.publishLater')}</p>` : ''}
            <p class="form-error" role="alert" hidden data-error></p>
            <p class="muted" role="status" data-progress></p>
            <div class="listing-form__buttons">
              ${draft
                ? html`
                    <button class="button ${canPublish ? 'button--outline' : 'button--primary'}" type="submit" value="draft" data-send>${t('listing.saveDraft')}</button>
                    ${canPublish ? html`<button class="button button--primary" type="submit" value="publish" data-send>${t('listing.publish')}</button>` : ''}`
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
      photo: items[0] ? { url: items[0].url, thumb: items[0].thumb, focus: items[0].focus } : { url: null, focus: '50% 40%' },
    };
    mount(preview, canvas(placePet(pet), { loading: 'lazy' }));
  };

  // ---------- Photos ----------
  let items: Item[] = (existing?.photos ?? []).map((p: ListingPhoto) => ({ id: p.id, url: p.url, thumb: p.thumb, focus: p.focus }));
  const removed: string[] = [];
  let arranged = false; // order or framing changed for photos already on the server
  let selected = 0;
  const grid = $('[data-photos]', root);
  const addLabel = $<HTMLLabelElement>('[data-photo-add]', root);
  const fileInput = $<HTMLInputElement>('[data-photo-input]', root);
  const photoStatus = $('[data-photo-status]', root);
  const focusPanel = $('[data-focus-panel]', root);
  const focusFrame = $<HTMLButtonElement>('[data-focus-frame]', root);

  const drawPhotos = () => {
    selected = Math.min(selected, Math.max(0, items.length - 1));
    mount(
      grid,
      html`${items.map(
        (it, i) => html`
          <li class="photo-tile${i === selected ? ' is-selected' : ''}">
            <button class="photo-tile__pick" type="button" data-pick="${i}" aria-pressed="${String(i === selected)}" aria-label="${t('listing.photoN', { n: i + 1 })}">
              <img src="${it.thumb ?? it.url}" alt="" style="object-position:${it.focus}" draggable="false" />
            </button>
            ${i === 0
              ? html`<span class="photo-tile__badge">${icon(Star, 14)}${t('listing.cover')}</span>`
              : html`<button class="photo-tile__action" type="button" data-cover="${i}">${icon(Star, 14)}${t('listing.makeCover')}</button>`}
            <button class="photo-tile__remove" type="button" data-remove="${i}" aria-label="${t('listing.removePhoto', { n: i + 1 })}">${icon(X, 16)}</button>
          </li>`,
      )}`,
    );
    addLabel.hidden = items.length >= MAX_PHOTOS;
    focusPanel.hidden = !items.length;
    const it = items[selected];
    if (it) {
      const [x, y] = it.focus.split(' ');
      mount(focusFrame, html`<img src="${it.url}" alt="" draggable="false" /><span class="photo-focus__dot" style="left:${x};top:${y}"></span>`);
      focusFrame.setAttribute('aria-label', t('listing.focusLabel', { x: parseInt(x), y: parseInt(y) }));
    }
    draw();
  };

  grid.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!b) return;
    if (b.dataset.pick) selected = Number(b.dataset.pick);
    if (b.dataset.cover) {
      const [it] = items.splice(Number(b.dataset.cover), 1);
      items.unshift(it);
      selected = 0;
      arranged = true;
    }
    if (b.dataset.remove) {
      const [it] = items.splice(Number(b.dataset.remove), 1);
      if (it.id) removed.push(it.id);
      else (URL.revokeObjectURL(it.url), it.thumb && URL.revokeObjectURL(it.thumb));
      arranged = true;
    }
    drawPhotos();
  });

  fileInput.addEventListener('change', async () => {
    const files = [...(fileInput.files ?? [])];
    fileInput.value = '';
    const room = MAX_PHOTOS - items.length;
    if (files.length > room) photoStatus.textContent = t('listing.photosRoom', { n: room });
    for (const file of files.slice(0, room)) {
      photoStatus.textContent = t('listing.preparing');
      try {
        const prepared = await preparePhoto(file);
        items.push({ url: URL.createObjectURL(prepared.full), thumb: URL.createObjectURL(prepared.thumb), focus: '50% 40%', prepared });
        error.hidden = true; // "add a photo" no longer applies
        selected = items.length - 1;
        photoStatus.textContent = '';
      } catch (err) {
        photoStatus.textContent = t(err instanceof PhotoError && err.message === 'too_small' ? 'listing.photoTooSmall' : 'listing.photoUnreadable');
      }
      drawPhotos();
    }
    if (files.length > room) photoStatus.textContent = t('listing.photosRoom', { n: room });
  });

  // Framing: tap where the face is. Arrow keys nudge it, for keyboards.
  const setFocus = (x: number, y: number) => {
    const it = items[selected];
    if (!it) return;
    const clamp = (v: number) => Math.round(Math.min(100, Math.max(0, v)));
    it.focus = `${clamp(x)}% ${clamp(y)}%`;
    if (it.id) arranged = true;
    drawPhotos();
  };
  focusFrame.addEventListener('click', (e) => {
    const img = focusFrame.querySelector('img');
    if (!img || e.detail === 0) return; // a keyboard "click" (Enter/Space) carries no position
    const r = img.getBoundingClientRect();
    setFocus(((e.clientX - r.left) / r.width) * 100, ((e.clientY - r.top) / r.height) * 100);
  });
  focusFrame.addEventListener('keydown', (e) => {
    const step = { ArrowLeft: [-5, 0], ArrowRight: [5, 0], ArrowUp: [0, -5], ArrowDown: [0, 5] }[e.key];
    if (!step) return;
    e.preventDefault();
    const [x, y] = (items[selected]?.focus ?? '50% 40%').split(' ').map((v) => parseInt(v));
    setFocus(x + step[0], y + step[1]);
    focusFrame.focus();
  });

  let species = v.species;
  formEl.addEventListener('change', (e) => {
    const el = e.target as HTMLInputElement;
    if (el.dataset.photoInput !== undefined) return;
    if (el.name === 'ageMode') $$<HTMLElement>('[data-age]', root).forEach((b) => (b.hidden = b.dataset.age !== el.value));
    // "Otros perros" for a dog, "Perros" for a cat: the companion questions follow the species.
    if (el.name === 'species' && el.value !== species) {
      species = el.value as PetForm['species'];
      const now = read();
      mount($('[data-companions]', root), companionQuestions({ ...now, species }));
    }
    draw();
  });
  formEl.addEventListener('input', (e) => (e.target as HTMLElement).dataset.photoInput === undefined && draw());
  drawPhotos();

  // Saving: the listing (a new one starts as a draft), then new photos, removals, order and framing, and
  // only then publishing, so the server sees the photos it requires. If something fails halfway, the
  // next try picks up where this one stopped.
  let petId = existing?.id ?? null;
  const progress = $('[data-progress]', root);
  formEl.addEventListener('submit', async (e) => {
    e.preventDefault();
    const action = ((e as SubmitEvent).submitter as HTMLButtonElement | null)?.value ?? 'save';
    const publish = action === 'publish';
    const body = read();
    // Checks the server can't word for the person: no age yet, an unfinished name, no photo to publish.
    const local = !body.name ? 'invalid_name' : !body.birthDate ? 'invalid_birth_date' : publish && !items.length ? 'photo_required' : null;
    const buttons = $$<HTMLButtonElement>('[data-send]', root);
    const fail = (code: string) => {
      const known = code.startsWith('thumb_') ? 'invalid_image' : code === 'invalid_dimensions' ? 'invalid_image' : code;
      error.textContent = (ERRORS as readonly string[]).includes(known) ? t(`listing.err.${known as (typeof ERRORS)[number]}`) : t('auth.err.network');
      error.hidden = false;
      progress.textContent = '';
      error.scrollIntoView({ block: 'center', behavior: 'smooth' });
      buttons.forEach((b) => (b.disabled = false));
    };
    error.hidden = true;
    if (local) return fail(local);
    buttons.forEach((b) => (b.disabled = true));
    try {
      const fresh = !petId;
      if (!petId) petId = (await api.createPet(shelter.id, body, false)).id;
      const pending = items.filter((it) => !it.id);
      for (const [n, it] of pending.entries()) {
        progress.textContent = t('listing.uploading', { n: n + 1, total: pending.length });
        const saved = await api.uploadPhoto(petId, { image: await toBase64(it.prepared!.full), thumb: await toBase64(it.prepared!.thumb), focus: it.focus });
        URL.revokeObjectURL(it.url);
        if (it.thumb) URL.revokeObjectURL(it.thumb);
        Object.assign(it, { id: saved.id, url: saved.url, thumb: saved.thumb, prepared: undefined });
        arranged = true;
      }
      while (removed.length) {
        await api.deletePhoto(petId, removed[0]);
        removed.shift();
      }
      if (arranged && items.length) await api.arrangePhotos(petId, items.map((it) => ({ id: it.id!, focus: it.focus })));
      arranged = false;
      progress.textContent = '';
      const status = !fresh || publish ? (await api.savePet(petId, body, publish)).status : 'draft';
      toast(t(publish ? 'listing.published' : status === 'draft' ? 'listing.savedDraft' : 'listing.saved', { name: body.name }));
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

