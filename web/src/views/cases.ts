import { CircleCheck, Eye, EyeOff, HandHeart, HeartHandshake, PencilLine, Plus, Send, Trash2, type IconNode } from 'lucide';
import { api, ApiError, type CaseForm, type CasePet, type CaseShelter, type CaseStatus } from '../api';
import { frameFor, type HelpNeed, type PetSummary } from '../data';
import { $, $$, html, icon, mount, type Raw } from '../dom';
import { failText, formatDate, pesos, t, type Key } from '../i18n';
import { contactNumbers } from '../money';
import { navigate } from '../nav';
import { photo } from '../ui/canvas';
import { bindPhotoEditor, photoEditor } from '../ui/photo-editor';
import { closeSheet, openSheet } from '../ui/sheet';
import { toast } from '../ui/toast';

// A shelter's help cases in the portal (owner decision, 2026-10-28): the list at /refugio/<id>/casos and each
// case at …/casos/nuevo or …/casos/<caseId>. Members of a verified shelter, or an admin for one, write them;
// donors see open ones at /ayudar, with the shelter's own accounts. A case is drafted first (photos go to its
// id), published once the shelter has accounts, kept fresh with news, and closed with what happened.

const NEEDS: HelpNeed[] = ['cirugia', 'tratamiento', 'examenes', 'medicinas', 'recuperacion', 'otro'];
const STATUS_ICON: Record<CaseStatus, IconNode> = { draft: PencilLine, open: Eye, resolved: HeartHandshake, closed: EyeOff };
/** The listing chips' colours: a draft, live, ended well, ended. */
const CHIP: Record<CaseStatus, string> = { draft: 'draft', open: 'available', resolved: 'adopted', closed: 'withdrawn' };
const chip = (s: CaseStatus) => html`<span class="status-chip status-chip--pet-${CHIP[s]}">${icon(STATUS_ICON[s], 16)}${t(`cases.status.${s}`)}</span>`;

const ERRORS = [
  'invalid_species', 'invalid_name', 'invalid_need', 'invalid_cost', 'invalid_pet', 'contact_in_text', 'no_donation_accounts', 'story_required',
  'photo_required', 'shelter_not_verified', 'shelter_suspended', 'case_ended', 'too_many_cases', 'update_too_short', 'outcome_too_short', 'not_open',
  'too_many_updates', 'invalid_status',
] as const;
/** Photo errors read the same as on a listing. */
const PHOTO_ERRORS = ['photos_full', 'upload_limit', 'storage_full', 'image_too_large', 'invalid_image', 'duplicate_photo', 'last_photo'];

const quoted = (numbers: string[]) => numbers.map((n) => `«${n}»`).join(', ');
function errorText(err: unknown): string {
  const code = err instanceof ApiError ? err.code : typeof err === 'string' ? err : 'network';
  const known = code.startsWith('thumb_') || code === 'invalid_dimensions' ? 'invalid_image' : code;
  if ((ERRORS as readonly string[]).includes(known)) {
    const numbers = err instanceof ApiError && Array.isArray(err.data.numbers) ? (err.data.numbers as string[]) : [];
    return t(`cases.err.${known as (typeof ERRORS)[number]}`, { numbers: quoted(numbers) });
  }
  if (PHOTO_ERRORS.includes(known)) return t(`listing.err.${known}` as Key);
  return failText(known);
}

const notFound = (root: HTMLElement) =>
  mount(root, html`<section class="portal"><p class="loading-note" role="alert">${t('cases.notFound')}</p><a class="button button--outline" href="/refugio">${t('portal.back')}</a></section>`);

/** Why this shelter can't publish (yet), or null. */
const blocked = (s: CaseShelter): Key | null =>
  s.status === 'suspended' ? 'cases.err.shelter_suspended' : s.status !== 'verified' ? 'cases.err.shelter_not_verified' : !s.hasDonation ? 'cases.noDonation' : null;
const backTo = (s: CaseShelter) => (s.role === 'admin' ? '/refugio/admin/casos' : '/refugio');

// ---------- The shelter's cases ----------

export async function renderCases(root: HTMLElement, shelterId: string) {
  mount(root, html`<p class="loading-note" role="status">${t('portal.loading')}</p>`);
  let data: Awaited<ReturnType<typeof api.shelterCases>>;
  try {
    data = await api.shelterCases(shelterId);
  } catch {
    return notFound(root);
  }
  const { shelter, cases } = data;
  const base = `/refugio/${encodeURIComponent(shelter.id)}/casos`;
  const why = blocked(shelter);
  mount(
    root,
    html`
      <section class="portal" aria-labelledby="portal-title">
        <a class="text-button portal__back" href="${backTo(shelter)}">${t('portal.back')}</a>
        <div class="listings__head">
          <h1 class="page-title" id="portal-title" tabindex="-1" data-focus>${t('cases.title')}</h1>
          <p class="portal__who">${shelter.name}</p>
        </div>
        <p class="portal__lede">${t('cases.lede')}</p>
        ${shelter.role === 'admin' ? html`<p class="portal-card__reason">${t('cases.adminNote', { shelter: shelter.name })}</p>` : ''}
        ${why ? html`<p class="portal-card__reason">${t(why)}</p>` : ''}
        ${shelter.status === 'verified' ? html`<a class="button button--primary portal__new" href="${base}/nuevo">${icon(Plus, 20)}${t('cases.add')}</a>` : ''}
        ${cases.length
          ? html`<ul class="listings">
              ${cases.map(
                (k) => html`
                  <li class="listing-item">
                    <a class="listing-row" href="${base}/${encodeURIComponent(k.id)}">
                      <span class="mini-frame mini-frame--sm" data-frame="${frameFor(k.id)}">${photo({ id: k.id, photo: k.photo ?? { url: null, focus: '50% 40%' } } as PetSummary, 'lazy', true)}</span>
                      <span class="listing-row__text">
                        <strong class="listing-row__name">${k.name}</strong>
                        <span class="listing-row__meta">${t(`help.need.${k.need}`)}${k.costDop ? ` · ${pesos(k.costDop)}` : ''}</span>
                        ${k.stale ? html`<span class="listing-row__meta case-stale">${t('cases.stale')}</span>` : ''}
                      </span>
                      ${chip(k.status)}
                    </a>
                  </li>`,
              )}
            </ul>`
          : html`<p class="passed__empty">${t('cases.empty')}</p>`}
      </section>`,
  );
}

// ---------- One case ----------

type Full = Awaited<ReturnType<typeof api.portalCase>>['case'];

export async function renderCaseForm(root: HTMLElement, shelterId: string, caseId: string | null) {
  mount(root, html`<p class="loading-note" role="status">${t('portal.loading')}</p>`);
  try {
    if (caseId) {
      const { shelter, case: k, pets } = await api.portalCase(caseId);
      if (shelter.id !== shelterId) throw new ApiError('not_found', {});
      return k.status === 'resolved' || k.status === 'closed' ? endedView(root, shelter, k) : form(root, shelter, pets, k);
    }
    const { shelter, pets } = await api.shelterCases(shelterId);
    if (shelter.status !== 'verified') throw new ApiError('not_found', {});
    form(root, shelter, pets, null);
  } catch {
    notFound(root);
  }
}

const BLANK: CaseForm = { species: 'perro', name: '', need: 'cirugia', story: '', costDop: null, alsoNeeded: null, petId: null };

function form(root: HTMLElement, shelter: CaseShelter, pets: CasePet[], existing: Full | null) {
  const v: CaseForm = existing ? { ...BLANK, ...existing } : { ...BLANK };
  const draft = !existing || existing.status === 'draft';
  const canPublish = !blocked(shelter);
  const list = `/refugio/${encodeURIComponent(shelter.id)}/casos`;
  const segmented = (name: string, legend: string, options: [string, string][], value: string, wrap = false) => html`
    <fieldset class="question">
      <legend>${legend}</legend>
      <div class="segmented${wrap ? ' segmented--wrap' : ''}">
        ${options.map(([val, label]) => html`<label><input type="radio" name="${name}" value="${val}" ${val === value ? 'checked' : ''} /><span>${label}</span></label>`)}
      </div>
    </fieldset>`;

  mount(
    root,
    html`
      <section class="portal portal--listing" aria-labelledby="portal-title">
        <a class="text-button portal__back" href="${list}">${t('cases.back')}</a>
        <h1 class="page-title" id="portal-title" tabindex="-1" data-focus>${existing ? existing.name : t('cases.newTitle')}</h1>
        ${existing ? html`<p class="listing-status">${chip(existing.status)}</p>` : ''}
        ${shelter.role === 'admin' ? html`<p class="portal-card__reason">${t('cases.adminNote', { shelter: shelter.name })}</p>` : ''}
        ${existing?.stale ? html`<p class="portal-card__reason">${t('cases.stale')}</p>` : ''}
        ${existing?.status === 'open' && !existing.stale && shelter.hasDonation
          ? html`<a class="button button--outline button--small listing-copy" href="/caso/${encodeURIComponent(existing.id)}">${icon(Eye, 16)}${t('cases.view')}</a>`
          : ''}
        <form class="portal-form listing-form" id="case-form" novalidate>
          <fieldset class="form-section">
            <legend class="section-title">${t('listing.photos')}</legend>
            <p class="muted">${t('cases.photosNote')}</p>
            ${photoEditor()}
          </fieldset>

          <fieldset class="form-section">
            <legend class="section-title">${t('cases.basics')}</legend>
            ${segmented('species', t('listing.speciesLabel'), [['perro', t('listing.species.perro')], ['gato', t('listing.species.gato')]], v.species)}
            <label class="field">
              <span class="field__label">${t('cases.name')}</span>
              <input class="field__input" name="name" maxlength="40" value="${v.name}" autocomplete="off" />
            </label>
            ${segmented('need', t('cases.need'), NEEDS.map((n) => [n, t(`help.need.${n}`)]), v.need, true)}
            ${pets.length
              ? html`<label class="field">
                  <span class="field__label">${t('cases.pet')} <span class="muted">(${t('request.optional')})</span></span>
                  <select class="field__input" name="petId" aria-describedby="pet-hint">
                    <option value="">${t('cases.petNone')}</option>
                    ${pets.map((p) => html`<option value="${p.id}" ${p.id === v.petId ? 'selected' : ''}>${p.name} (${t(`listing.species.${p.species}`)})</option>`)}
                  </select>
                  <span class="field__hint" id="pet-hint">${t('cases.petHint')}</span>
                </label>`
              : ''}
          </fieldset>

          <fieldset class="form-section">
            <legend class="section-title">${t('help.story')}</legend>
            <label class="field">
              <span class="field__label">${t('cases.story')}</span>
              <textarea class="field__input field__input--area" name="story" rows="6" maxlength="2000">${v.story}</textarea>
              <span class="field__hint">${t('cases.storyHint')}</span>
            </label>
            <label class="field">
              <span class="field__label">${t('cases.cost')} <span class="muted">(${t('request.optional')})</span></span>
              <span class="money"><span class="money__unit" aria-hidden="true">RD$</span><input class="field__input" name="cost" type="number" inputmode="numeric" min="1" max="2000000" step="1" value="${v.costDop ?? ''}" aria-describedby="cost-hint" /></span>
              <span class="field__hint" id="cost-hint">${t('cases.costHint')}</span>
            </label>
            <label class="field">
              <span class="field__label">${t('cases.alsoNeeded')} <span class="muted">(${t('request.optional')})</span></span>
              <textarea class="field__input field__input--area" name="alsoNeeded" rows="2" maxlength="300" aria-describedby="also-hint">${v.alsoNeeded ?? ''}</textarea>
              <span class="field__hint" id="also-hint">${t('cases.alsoNeededHint')}</span>
            </label>
            <p class="money-warning" role="status" data-numbers hidden></p>
          </fieldset>

          <div class="listing-form__actions">
            ${draft && !canPublish ? html`<p class="muted">${t('cases.publishLater')}</p>` : ''}
            <p class="form-error" role="alert" hidden data-error></p>
            <p class="muted" role="status" data-progress></p>
            <div class="listing-form__buttons">
              ${draft
                ? html`
                    <button class="button ${canPublish ? 'button--outline' : 'button--primary'}" type="submit" value="draft" data-send>${t('cases.saveDraft')}</button>
                    ${canPublish ? html`<button class="button button--primary" type="submit" value="publish" data-send>${t('cases.publish')}</button>` : ''}`
                : html`<button class="button button--primary" type="submit" value="save" data-send>${t('cases.save')}</button>`}
            </div>
          </div>
        </form>
        ${existing?.status === 'open' ? updates(existing) : ''}
        ${existing?.status === 'open'
          ? html`<button class="button button--outline case-end" type="button" data-end>${icon(CircleCheck, 20)}${t('cases.end')}</button>`
          : ''}
        ${existing?.status === 'draft' ? html`<button class="button button--ghost case-end" type="button" data-delete>${icon(Trash2, 18)}${t('cases.deleteDraft')}</button>` : ''}
      </section>`,
  );

  const formEl = $<HTMLFormElement>('#case-form', root);
  const error = $('[data-error]', root);
  const progress = $('[data-progress]', root);
  const photos = bindPhotoEditor(root, existing?.photos ?? [], { onAdd: () => (error.hidden = true) });

  const read = (): CaseForm => {
    const f = new FormData(formEl);
    const s = (k: string) => String(f.get(k) ?? '').trim();
    return {
      species: s('species') as CaseForm['species'],
      name: s('name'),
      need: s('need') as HelpNeed,
      story: s('story'),
      costDop: s('cost') === '' ? null : Number(s('cost')),
      alsoNeeded: s('alsoNeeded') || null,
      petId: s('petId') || null,
    };
  };

  // A phone or account number in the text: say so while they write, since saving would refuse it.
  const numbersBox = $('[data-numbers]', root);
  const checkNumbers = () => {
    const k = read();
    const found = contactNumbers(k.name, k.story, k.alsoNeeded);
    numbersBox.hidden = !found.length;
    numbersBox.textContent = found.length ? t('cases.numbers', { numbers: quoted(found) }) : '';
  };
  formEl.addEventListener('input', (e) => (e.target as HTMLElement).dataset.photoInput === undefined && checkNumbers());
  checkNumbers();

  // Saving: the case (a new one starts as a draft), then its photos, and only then publishing, so the
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
    const local = !body.name ? 'invalid_name' : publish && !photos.items.length ? 'photo_required' : null;
    if (local) return fail(local);
    buttons.forEach((b) => (b.disabled = true));
    try {
      const fresh = !id;
      if (!id) id = (await api.createCase(shelter.id, body)).id;
      const caseId = id;
      await photos.sync(
        { upload: (b) => api.uploadCasePhoto(caseId, b), arrange: (all) => api.arrangeCasePhotos(caseId, all), remove: (photoId) => api.deleteCasePhoto(caseId, photoId) },
        (n, total) => (progress.textContent = t('listing.uploading', { n, total })),
      );
      progress.textContent = '';
      const saved = !fresh || publish ? await api.saveCase(caseId, body, publish) : { status: 'draft' as CaseStatus };
      toast(t(publish ? 'cases.published' : saved.status === 'draft' ? 'cases.savedDraft' : 'cases.saved', { name: body.name }));
      // An open case stays on its page (news and closing are below the form); the others go back to the list.
      if (publish || saved.status === 'draft') navigate(list);
      else void renderCaseForm(root, shelter.id, caseId);
    } catch (err) {
      fail(err);
    }
  });

  if (existing?.status === 'open') bindUpdates(root, existing, () => void renderCaseForm(root, shelter.id, existing.id));
  root.querySelector('[data-end]')?.addEventListener('click', () => openEnd(existing!, () => void renderCaseForm(root, shelter.id, existing!.id)));
  root.querySelector('[data-delete]')?.addEventListener('click', () => openDelete(existing!, () => navigate(list)));
}

/** News on an open case: write one, or take back one posted by mistake. */
function updates(k: Full): Raw {
  return html`
    <section class="portal-card case-news" aria-labelledby="news-title">
      <h2 class="section-title" id="news-title">${t('cases.updates')}</h2>
      <p class="muted">${t('cases.updatesLede')}</p>
      <form class="case-news__form" data-news novalidate>
        <label class="field">
          <span class="sr-only">${t('cases.updates')}</span>
          <textarea class="field__input field__input--area" name="body" rows="3" maxlength="1000" placeholder="${t('cases.updatePlaceholder')}"></textarea>
        </label>
        <p class="form-error" role="alert" hidden data-news-error></p>
        <button class="button button--outline button--small" type="submit">${icon(Send, 16)}${t('cases.postUpdate')}</button>
      </form>
      ${k.updates.length
        ? html`<ol class="case-updates">
            ${k.updates.map(
              (u) => html`<li>
                <time datetime="${u.at}">${formatDate(u.at.slice(0, 10))}</time>
                <p>${u.body}</p>
                <button class="text-button" type="button" data-unpost="${u.id}">${t('cases.removeUpdate')}</button>
              </li>`,
            )}
          </ol>`
        : html`<p class="muted">${t('cases.noUpdates')}</p>`}
    </section>`;
}

function bindUpdates(root: HTMLElement, k: Full, redraw: () => void) {
  const formEl = $<HTMLFormElement>('[data-news]', root);
  const error = $('[data-news-error]', root);
  formEl.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $<HTMLButtonElement>('button[type=submit]', formEl);
    const body = String(new FormData(formEl).get('body') ?? '').trim();
    error.hidden = true;
    btn.disabled = true;
    try {
      await api.postCaseUpdate(k.id, body);
      toast(t('cases.updatePosted'));
      redraw();
    } catch (err) {
      error.textContent = errorText(err);
      error.hidden = false;
      btn.disabled = false;
    }
  });
  $$<HTMLButtonElement>('[data-unpost]', root).forEach((b) =>
    b.addEventListener('click', async () => {
      b.disabled = true;
      try {
        await api.deleteCaseUpdate(k.id, b.dataset.unpost!);
        toast(t('cases.updateRemoved'));
        redraw();
      } catch (err) {
        b.disabled = false;
        toast(errorText(err));
      }
    }),
  );
}

/** "Cerrar el caso": how it ended, in the shelter's words, for everyone who helped. */
function openEnd(k: Full, done: () => void) {
  const dialog = openSheet(
    t('cases.end'),
    html`
      <form class="outcome__form" novalidate>
        <p>${t('cases.endLede')}</p>
        <fieldset class="question">
          <legend>${t('cases.endHow')}</legend>
          <div class="segmented segmented--stack">
            <label><input type="radio" name="status" value="resolved" checked /><span>${t('cases.endResolved')}</span></label>
            <label><input type="radio" name="status" value="closed" /><span>${t('cases.endClosed')}</span></label>
          </div>
        </fieldset>
        <label class="field">
          <span class="field__label">${t('cases.outcome')}</span>
          <textarea class="field__input field__input--area" name="outcome" rows="4" maxlength="1000" placeholder="${t('cases.outcomePlaceholder')}"></textarea>
        </label>
        <p class="form-error" role="alert" hidden data-end-error></p>
        <button class="button button--primary button--block" type="submit">${icon(CircleCheck, 20)}${t('cases.end')}</button>
      </form>`,
  );
  const formEl = $<HTMLFormElement>('form', dialog);
  formEl.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $<HTMLButtonElement>('button[type=submit]', formEl);
    const f = new FormData(formEl);
    const error = $('[data-end-error]', formEl);
    btn.disabled = true;
    try {
      await api.endCase(k.id, f.get('status') as 'resolved' | 'closed', String(f.get('outcome') ?? '').trim());
      closeSheet();
      toast(t('cases.ended', { name: k.name }));
      done();
    } catch (err) {
      error.textContent = errorText(err);
      error.hidden = false;
      btn.disabled = false;
    }
  });
}

function openDelete(k: Full, done: () => void) {
  const dialog = openSheet(
    t('cases.deleteTitle', { name: k.name }),
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
      await api.deleteCase(k.id);
      closeSheet();
      toast(t('cases.deleted'));
      done();
    } catch (err) {
      btn.disabled = false;
      toast(errorText(err));
    }
  });
}

/** A case that ended stays as it ended: what happened, and the news it had. */
function endedView(root: HTMLElement, shelter: CaseShelter, k: Full) {
  const list = `/refugio/${encodeURIComponent(shelter.id)}/casos`;
  mount(
    root,
    html`
      <section class="portal" aria-labelledby="portal-title">
        <a class="text-button portal__back" href="${list}">${t('cases.back')}</a>
        <h1 class="page-title" id="portal-title" tabindex="-1" data-focus>${k.name}</h1>
        <p class="listing-status">${chip(k.status)}${k.endedAt ? html` <span class="muted">${formatDate(k.endedAt.slice(0, 10))}</span>` : ''}</p>
        <div class="portal-card">
          <h2 class="section-title">${t('cases.outcomeLabel')}</h2>
          <p>${k.outcome ?? ''}</p>
          <a class="button button--outline button--small" href="/caso/${encodeURIComponent(k.id)}">${icon(HandHeart, 16)}${t('cases.view')}</a>
        </div>
        ${k.updates.length
          ? html`<div class="portal-card case-news">
              <h2 class="section-title">${t('cases.updates')}</h2>
              <ol class="case-updates">${k.updates.map((u) => html`<li><time datetime="${u.at}">${formatDate(u.at.slice(0, 10))}</time><p>${u.body}</p></li>`)}</ol>
            </div>`
          : ''}
      </section>`,
  );
}

/** Admins: pick the verified shelter a case is for. The case is that shelter's, with its accounts. */
export async function renderAdminCases(root: HTMLElement) {
  mount(root, html`<p class="loading-note" role="status">${t('portal.loading')}</p>`);
  let shelters: Awaited<ReturnType<typeof api.adminShelters>>['shelters'];
  try {
    shelters = (await api.adminShelters('verified')).shelters.filter((s) => s.kind !== 'private');
  } catch {
    return notFound(root);
  }
  mount(
    root,
    html`
      <section class="portal portal--admin" aria-labelledby="portal-title">
        <a class="text-button portal__back" href="/refugio/admin">${t('portal.back')}</a>
        <h1 class="page-title" id="portal-title" tabindex="-1" data-focus>${t('cases.admin.title')}</h1>
        <p class="portal__lede">${t('cases.admin.lede')}</p>
        ${shelters.length
          ? html`<ul class="listings">
              ${shelters.map(
                (s) => html`<li class="listing-item">
                  <a class="listing-row" href="/refugio/${encodeURIComponent(s.id)}/casos">
                    <span class="shelter__mark" aria-hidden="true">${icon(HandHeart, 22)}</span>
                    <span class="listing-row__text">
                      <strong class="listing-row__name">${s.name}</strong>
                      ${s.place ? html`<span class="listing-row__meta">${s.place.name}, ${s.place.municipality}</span>` : ''}
                    </span>
                  </a>
                </li>`,
              )}
            </ul>`
          : html`<p class="passed__empty">${t('cases.admin.empty')}</p>`}
      </section>`,
  );
}
