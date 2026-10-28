import { CircleCheck, Eye, EyeOff, HeartHandshake, PencilLine, Plus, RotateCcw, Trash2, type IconNode } from 'lucide';
import { api, ApiError, type LostForm, type LostShelter, type LostStatus, type PortalLost } from '../api';
import { frameFor, type PetSummary } from '../data';
import { $, $$, html, icon, mount } from '../dom';
import { failText, formatDate, t, type Key } from '../i18n';
import { contactNumbers } from '../money';
import { navigate } from '../nav';
import { photo } from '../ui/canvas';
import { bindPhotoEditor, photoEditor } from '../ui/photo-editor';
import { bindPlacePick, placePick } from '../ui/place-pick';
import { closeSheet, openSheet } from '../ui/sheet';
import { toast } from '../ui/toast';
import { kindChip, lostTitle } from './lost';

// A shelter's lost and found posts in the portal (owner decision, 2026-10-28): the list at
// /refugio/<id>/perdidos and each post at …/perdidos/nuevo or …/perdidos/<postId>. Members of a verified shelter
// (or an admin, for one) write them; the public sees open ones at /perdidos and calls the shelter's public
// phone, which a post needs before it's published. A post is drafted first (photos go to its id), lasts 30
// days unless renewed, and ends when the animal is home or the shelter closes it.

const STATUS_ICON: Record<LostStatus, IconNode> = { draft: PencilLine, open: Eye, home: HeartHandshake, closed: EyeOff };
/** The listing chips' colours: a draft, live, ended well, ended. */
const CHIP: Record<LostStatus, string> = { draft: 'draft', open: 'available', home: 'adopted', closed: 'withdrawn' };
const chip = (s: LostStatus) => html`<span class="status-chip status-chip--pet-${CHIP[s]}">${icon(STATUS_ICON[s], 16)}${t(`lostp.status.${s}`)}</span>`;

const ERRORS = [
  'invalid_kind', 'invalid_species', 'invalid_sex', 'invalid_place', 'invalid_seen_on', 'contact_in_text', 'no_public_phone', 'description_required',
  'photo_required', 'shelter_not_verified', 'shelter_suspended', 'post_ended', 'too_many_posts', 'not_open', 'invalid_status',
] as const;
const PHOTO_ERRORS = ['photos_full', 'upload_limit', 'storage_full', 'image_too_large', 'invalid_image', 'duplicate_photo', 'last_photo'];

const quoted = (numbers: string[]) => numbers.map((n) => `«${n}»`).join(', ');
function errorText(err: unknown): string {
  const code = err instanceof ApiError ? err.code : typeof err === 'string' ? err : 'network';
  const known = code.startsWith('thumb_') || code === 'invalid_dimensions' ? 'invalid_image' : code;
  if ((ERRORS as readonly string[]).includes(known)) {
    const numbers = err instanceof ApiError && Array.isArray(err.data.numbers) ? (err.data.numbers as string[]) : [];
    return t(`lostp.err.${known as (typeof ERRORS)[number]}`, { numbers: quoted(numbers) });
  }
  if (PHOTO_ERRORS.includes(known)) return t(`listing.err.${known}` as Key);
  return failText(known);
}

const notFound = (root: HTMLElement) =>
  mount(root, html`<section class="portal"><p class="loading-note" role="alert">${t('lostp.notFound')}</p><a class="button button--outline" href="/refugio">${t('portal.back')}</a></section>`);

/** Why this shelter can't publish (yet), or null. */
const blocked = (s: LostShelter): Key | null =>
  s.status === 'suspended' ? 'lostp.err.shelter_suspended' : s.status !== 'verified' ? 'lostp.err.shelter_not_verified' : !s.hasPhone ? 'lostp.noPhone' : null;
const backTo = (s: LostShelter) => (s.role === 'admin' ? '/refugio/admin/casos' : '/refugio');
const today = () => new Date().toISOString().slice(0, 10);

// ---------- The shelter's posts ----------

export async function renderLostPosts(root: HTMLElement, shelterId: string) {
  mount(root, html`<p class="loading-note" role="status">${t('portal.loading')}</p>`);
  let data: Awaited<ReturnType<typeof api.shelterLost>>;
  try {
    data = await api.shelterLost(shelterId);
  } catch {
    return notFound(root);
  }
  const { shelter, posts } = data;
  const base = `/refugio/${encodeURIComponent(shelter.id)}/perdidos`;
  const why = blocked(shelter);
  mount(
    root,
    html`
      <section class="portal" aria-labelledby="portal-title">
        <a class="text-button portal__back" href="${backTo(shelter)}">${t('portal.back')}</a>
        <div class="listings__head">
          <h1 class="page-title" id="portal-title" tabindex="-1" data-focus>${t('lostp.title')}</h1>
          <p class="portal__who">${shelter.name}</p>
        </div>
        <p class="portal__lede">${t('lostp.lede')}</p>
        ${shelter.role === 'admin' ? html`<p class="portal-card__reason">${t('cases.adminNote', { shelter: shelter.name })}</p>` : ''}
        ${why ? html`<p class="portal-card__reason">${t(why)}</p>` : ''}
        ${shelter.status === 'verified' ? html`<a class="button button--primary portal__new" href="${base}/nuevo">${icon(Plus, 20)}${t('lostp.add')}</a>` : ''}
        ${posts.length
          ? html`<ul class="listings">
              ${posts.map(
                (l) => html`
                  <li class="listing-item">
                    <a class="listing-row" href="${base}/${encodeURIComponent(l.id)}">
                      <span class="mini-frame mini-frame--sm" data-frame="${frameFor(l.id)}">${photo({ id: l.id, photo: l.photo ?? { url: null, focus: '50% 40%' } } as PetSummary, 'lazy', true)}</span>
                      <span class="listing-row__text">
                        <strong class="listing-row__name">${l.name ?? lostTitle(l)}</strong>
                        <span class="listing-row__meta">${kindChip(l)} ${l.place ? `${l.place.name} · ` : ''}${formatDate(l.seenOn)}</span>
                        ${l.expired ? html`<span class="listing-row__meta case-stale">${t('lostp.expired')}</span>` : ''}
                      </span>
                      ${chip(l.status)}
                    </a>
                  </li>`,
              )}
            </ul>`
          : html`<p class="passed__empty">${t('lostp.empty')}</p>`}
      </section>`,
  );
}

// ---------- One post ----------

type Full = Awaited<ReturnType<typeof api.portalLost>>['post'];

export async function renderLostForm(root: HTMLElement, shelterId: string, postId: string | null) {
  mount(root, html`<p class="loading-note" role="status">${t('portal.loading')}</p>`);
  try {
    if (postId) {
      const { shelter, post } = await api.portalLost(postId);
      if (shelter.id !== shelterId) throw new ApiError('not_found', {});
      return form(root, shelter, post);
    }
    const { shelter } = await api.shelterLost(shelterId);
    if (shelter.status !== 'verified') throw new ApiError('not_found', {});
    form(root, shelter, null);
  } catch {
    notFound(root);
  }
}

function form(root: HTMLElement, shelter: LostShelter, existing: Full | null) {
  const draft = !existing || existing.status === 'draft';
  const done = existing?.status === 'home' || existing?.status === 'closed';
  const canPublish = !blocked(shelter);
  const list = `/refugio/${encodeURIComponent(shelter.id)}/perdidos`;
  const v = existing ?? { kind: 'perdido', species: 'perro', name: null, sex: null, description: '', place: null, seenOn: today() };
  const segmented = (name: string, legend: string, options: [string, string][], value: string) => html`
    <fieldset class="question">
      <legend>${legend}</legend>
      <div class="segmented${options.length === 3 ? ' segmented--three' : ''}">
        ${options.map(([val, label]) => html`<label><input type="radio" name="${name}" value="${val}" ${val === value ? 'checked' : ''} ${done ? 'disabled' : ''} /><span>${label}</span></label>`)}
      </div>
    </fieldset>`;

  mount(
    root,
    html`
      <section class="portal portal--listing" aria-labelledby="portal-title">
        <a class="text-button portal__back" href="${list}">${t('lostp.back')}</a>
        <h1 class="page-title" id="portal-title" tabindex="-1" data-focus>${existing ? (existing.name ?? lostTitle(existing)) : t('lostp.newTitle')}</h1>
        ${existing ? html`<p class="listing-status">${chip(existing.status)}${existing.endedAt ? html` <span class="muted">${formatDate(existing.endedAt.slice(0, 10))}</span>` : ''}</p>` : ''}
        ${shelter.role === 'admin' ? html`<p class="portal-card__reason">${t('cases.adminNote', { shelter: shelter.name })}</p>` : ''}
        ${existing?.expired ? html`<p class="portal-card__reason">${t('lostp.expired')}</p>` : ''}
        ${existing && existing.status !== 'draft' && !existing.expired && shelter.hasPhone
          ? html`<a class="button button--outline button--small listing-copy" href="/perdidos/${encodeURIComponent(existing.id)}">${icon(Eye, 16)}${t('lostp.view')}</a>`
          : ''}
        ${existing?.status === 'open'
          ? html`<div class="portal-card__actions">
              <button class="button button--outline button--small" type="button" data-renew>${icon(RotateCcw, 16)}${t('lostp.renew')}</button>
              <button class="button button--outline button--small" type="button" data-end>${icon(CircleCheck, 16)}${t('lostp.end')}</button>
            </div>`
          : ''}
        ${done
          ? ''
          : html`
        <form class="portal-form listing-form" id="lost-form" novalidate>
          <fieldset class="form-section">
            <legend class="section-title">${t('listing.photos')}</legend>
            <p class="muted">${t('lostp.photosNote')}</p>
            ${photoEditor()}
          </fieldset>

          <fieldset class="form-section">
            <legend class="section-title">${t('lostp.basics')}</legend>
            ${segmented('kind', t('lostp.kind'), [['perdido', t('lostp.kind.perdido')], ['encontrado', t('lostp.kind.encontrado')]], v.kind)}
            ${segmented('species', t('listing.speciesLabel'), [['perro', t('listing.species.perro')], ['gato', t('listing.species.gato')]], v.species)}
            <label class="field">
              <span class="field__label">${t('lostp.name')} <span class="muted">(${t('request.optional')})</span></span>
              <input class="field__input" name="name" maxlength="40" value="${v.name ?? ''}" autocomplete="off" aria-describedby="name-hint" />
              <span class="field__hint" id="name-hint">${t('lostp.nameHint')}</span>
            </label>
            ${segmented('sex', t('lost.sex'), [['hembra', t('sex.hembra')], ['macho', t('sex.macho')], ['', t('lost.unknown')]], v.sex ?? '')}
            ${placePick(t('lostp.place'), t('lostp.placeHint'), v.place)}
            <label class="field">
              <span class="field__label">${t('lostp.seenOn')}</span>
              <input class="field__input" name="seenOn" type="date" max="${today()}" value="${v.seenOn}" />
            </label>
          </fieldset>

          <fieldset class="form-section">
            <legend class="section-title">${t('lost.description')}</legend>
            <label class="field">
              <span class="sr-only">${t('lost.description')}</span>
              <textarea class="field__input field__input--area" name="description" rows="5" maxlength="1000" aria-describedby="description-hint">${v.description}</textarea>
              <span class="field__hint" id="description-hint">${t('lostp.descriptionHint')}</span>
            </label>
            <p class="money-warning" role="status" data-numbers hidden></p>
          </fieldset>

          <div class="listing-form__actions">
            ${draft && !canPublish ? html`<p class="muted">${t('lostp.publishLater')}</p>` : ''}
            <p class="form-error" role="alert" hidden data-error></p>
            <p class="muted" role="status" data-progress></p>
            <div class="listing-form__buttons">
              ${draft
                ? html`
                    <button class="button ${canPublish ? 'button--outline' : 'button--primary'}" type="submit" value="draft" data-send>${t('lostp.saveDraft')}</button>
                    ${canPublish ? html`<button class="button button--primary" type="submit" value="publish" data-send>${t('lostp.publish')}</button>` : ''}`
                : html`<button class="button button--primary" type="submit" value="save" data-send>${t('lostp.save')}</button>`}
            </div>
          </div>
        </form>`}
        ${existing?.status === 'draft' ? html`<button class="button button--ghost case-end" type="button" data-delete>${icon(Trash2, 18)}${t('cases.deleteDraft')}</button>` : ''}
      </section>`,
  );

  const redraw = () => void renderLostForm(root, shelter.id, existing!.id);
  root.querySelector('[data-renew]')?.addEventListener('click', async (e) => {
    const b = e.currentTarget as HTMLButtonElement;
    b.disabled = true;
    try {
      await api.renewLost(existing!.id);
      toast(t('lostp.renewed'));
      redraw();
    } catch (err) {
      b.disabled = false;
      toast(errorText(err));
    }
  });
  root.querySelector('[data-end]')?.addEventListener('click', () => openEnd(existing!, redraw));
  root.querySelector('[data-delete]')?.addEventListener('click', () => openDelete(existing!, () => navigate(list)));
  if (done) return;

  const formEl = $<HTMLFormElement>('#lost-form', root);
  const error = $('[data-error]', root);
  const progress = $('[data-progress]', root);
  const photos = bindPhotoEditor(root, existing?.photos ?? [], { onAdd: () => (error.hidden = true) });
  const where = bindPlacePick(root, v.place, (p) => (p ? t('lostp.placeChosen', { place: `${p.name}, ${p.municipality}` }) : t('lostp.placeHint')));

  const read = (): LostForm => {
    const f = new FormData(formEl);
    const s = (k: string) => String(f.get(k) ?? '').trim();
    return {
      kind: s('kind') as LostForm['kind'],
      species: s('species') as LostForm['species'],
      name: s('name') || null,
      sex: (s('sex') || null) as LostForm['sex'],
      description: s('description'),
      placeId: where.place?.id ?? '',
      seenOn: s('seenOn'),
    };
  };

  // A phone number in the text: say so while they write, since saving would refuse it.
  const numbersBox = $('[data-numbers]', root);
  const checkNumbers = () => {
    const l = read();
    const found = contactNumbers(l.name, l.description);
    numbersBox.hidden = !found.length;
    numbersBox.textContent = found.length ? t('lostp.numbers', { numbers: quoted(found) }) : '';
  };
  formEl.addEventListener('input', (e) => (e.target as HTMLElement).dataset.photoInput === undefined && checkNumbers());
  checkNumbers();

  // Saving: the post (a new one starts as a draft), then its photos, and only then publishing, so the
  // server sees the photo it requires. If something fails halfway, the next try picks up where it stopped.
  let id = existing?.id ?? null;
  formEl.addEventListener('submit', async (e) => {
    e.preventDefault();
    const publish = ((e as SubmitEvent).submitter as HTMLButtonElement | null)?.value === 'publish';
    const body = read();
    const buttons = $$<HTMLButtonElement>('[data-send]', root);
    const fail = (err: unknown) => {
      error.textContent = errorText(err);
      error.hidden = false;
      progress.textContent = '';
      error.scrollIntoView({ block: 'center', behavior: 'smooth' });
      buttons.forEach((b) => (b.disabled = false));
    };
    error.hidden = true;
    const local = !body.placeId ? 'invalid_place' : !body.seenOn ? 'invalid_seen_on' : publish && !photos.items.length ? 'photo_required' : null;
    if (local) return fail(local);
    buttons.forEach((b) => (b.disabled = true));
    try {
      const fresh = !id;
      if (!id) id = (await api.createLost(shelter.id, body)).id;
      const postId = id;
      await photos.sync(
        { upload: (b) => api.uploadLostPhoto(postId, b), arrange: (all) => api.arrangeLostPhotos(postId, all), remove: (photoId) => api.deleteLostPhoto(postId, photoId) },
        (n, total) => (progress.textContent = t('listing.uploading', { n, total })),
      );
      progress.textContent = '';
      const saved = !fresh || publish ? await api.saveLost(postId, body, publish) : { status: 'draft' as LostStatus };
      toast(t(publish ? 'lostp.published' : saved.status === 'draft' ? 'lostp.savedDraft' : 'lostp.saved'));
      if (publish || saved.status === 'draft') navigate(list);
      else void renderLostForm(root, shelter.id, postId);
    } catch (err) {
      fail(err);
    }
  });
}

/** "Cerrar el aviso": back home, or closed for another reason. */
function openEnd(l: PortalLost, done: () => void) {
  const dialog = openSheet(
    t('lostp.end'),
    html`
      <form class="outcome__form" novalidate>
        <p>${t('lostp.endLede')}</p>
        <fieldset class="question">
          <legend>${t('lostp.endHow')}</legend>
          <div class="segmented segmented--stack">
            <label><input type="radio" name="status" value="home" checked /><span>${t('lostp.endHome')}</span></label>
            <label><input type="radio" name="status" value="closed" /><span>${t('lostp.endClosed')}</span></label>
          </div>
        </fieldset>
        <button class="button button--primary button--block" type="submit">${icon(CircleCheck, 20)}${t('lostp.end')}</button>
      </form>`,
  );
  const formEl = $<HTMLFormElement>('form', dialog);
  formEl.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $<HTMLButtonElement>('button[type=submit]', formEl);
    const status = new FormData(formEl).get('status') as 'home' | 'closed';
    btn.disabled = true;
    try {
      await api.endLost(l.id, status);
      closeSheet();
      toast(t(status === 'home' ? 'lostp.homeDone' : 'lostp.closedDone'));
      done();
    } catch (err) {
      btn.disabled = false;
      toast(errorText(err));
    }
  });
}

function openDelete(l: PortalLost, done: () => void) {
  const dialog = openSheet(
    t('lostp.deleteTitle'),
    html`<form class="outcome__form" novalidate>
      <p>${t('cases.deleteBody')}</p>
      <button class="button button--ink button--block" type="submit">${icon(Trash2, 20)}${t('cases.deleteConfirm')}</button>
      <button class="button button--ghost button--block" type="button" data-keep>${t('cases.keep')}</button>
    </form>`,
  );
  $('[data-keep]', dialog).addEventListener('click', () => closeSheet());
  $<HTMLFormElement>('form', dialog).addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $<HTMLButtonElement>('button[type=submit]', dialog);
    btn.disabled = true;
    try {
      await api.deleteLost(l.id);
      closeSheet();
      toast(t('cases.deleted'));
      done();
    } catch (err) {
      btn.disabled = false;
      toast(errorText(err));
    }
  });
}
