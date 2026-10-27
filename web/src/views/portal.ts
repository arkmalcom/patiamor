import { BadgeCheck, CircleAlert, CirclePause, Clock, Eye, EyeOff, Flag, HandHeart, House, MapPin, MessageCircle, Plus, ShieldCheck, ShieldOff, UserCheck, Users, UsersRound } from 'lucide';
import { api, ApiError, type AdminAdopter, type AdminReviewPet, type AdminBulk, type AdminOwnerRequest, type AdminPaused, type AdminShelter, type BulkStatus, type PortalShelter, type ReferenceKind, type ShelterApplication, type ShelterForm, type ShelterStatus } from '../api';
import { frameFor, type Donation, type PetSummary, type Place } from '../data';
import { photo } from '../ui/canvas';
import { $, $$, html, icon, mount, type Raw } from '../dom';
import { formatDate, failText, pesos, t, type Key } from '../i18n';
import { bulkWhat } from '../ui/bulk';
import { setUser, state } from '../store';
import { openListerRequest } from '../ui/lister';
import { openOwnerRequest } from '../ui/owner';
import { renderAuth } from '../ui/auth';
import { renderInbox } from './inbox';
import { renderListingForm, renderListings } from './listings';
import { closeSheet, openSheet } from '../ui/sheet';
import { toast } from '../ui/toast';
import { navigate } from '../nav';

// The shelter portal (/refugio): register a shelter, follow its verification, and (for admins) work the
// verification queue. A shelter's animals live in listings.ts (PAT-8).

export type PortalView =
  | { view: 'home' }
  | { view: 'registro' }
  | { view: 'editar'; id: string }
  | { view: 'adminHub' }
  | { view: 'adminPaused' }
  | { view: 'adminReports' }
  | { view: 'rules'; next: string | null }
  | { view: 'adminAdopters'; email: string | null }
  | { view: 'adminShelters'; status: ShelterStatus }
  | { view: 'adminBulk'; status: BulkStatus }
  | { view: 'adminOwners'; status: BulkStatus }
  | { view: 'adminRegister'; owner: string | null; shelterName: string | null; phone: string | null }
  | { view: 'animales'; id: string; tab: string | null }
  | { view: 'animal'; id: string; petId: string | null; copyOf: string | null }
  | { view: 'solicitudes'; id: string; tab: string | null };

const STATUS_ICON: Record<ShelterStatus, typeof Clock> = { pending: Clock, verified: BadgeCheck, rejected: CircleAlert, suspended: ShieldOff };

const statusChip = (s: ShelterStatus) => html`<span class="status-chip status-chip--${s}">${icon(STATUS_ICON[s], 16)}${t(`portal.status.${s}`)}</span>`;

const where = (p: Place | null) => (p ? html`<span class="portal-card__place">${icon(MapPin, 15)}${p.name}, ${p.municipality}</span>` : '');

/** "+18095551234" → "809-555-1234". */
const showPhone = (p: string | null | undefined) => {
  const d = (p ?? '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
  return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` : (p ?? '');
};
const waLink = (p: string | null | undefined) => `https://wa.me/${(p ?? '').replace(/\D/g, '')}`;

export function renderPortal(root: HTMLElement, route: PortalView) {
  if (!state.signedIn) return signedOut(root);
  // Registering a shelter needs approval: everyone else sees where they stand, and can ask.
  if (route.view === 'registro') return state.user?.shelterOwner ? form(root, null) : void home(root);
  if (route.view === 'editar') return void edit(root, route.id);
  if (route.view === 'adminHub') return void adminHub(root);
  if (route.view === 'adminPaused') return void adminPausedQueue(root);
  if (route.view === 'adminReports') return void adminReportsQueue(root);
  if (route.view === 'rules') return rulesPage(root, route.next);
  if (route.view === 'adminAdopters') return void adminAdopters(root, route.email);
  if (route.view === 'adminShelters') return void adminQueue(root, route.status);
  if (route.view === 'adminBulk') return void adminBulkQueue(root, route.status);
  if (route.view === 'adminOwners') return void adminOwnersQueue(root, route.status);
  if (route.view === 'adminRegister') return state.user?.isAdmin ? form(root, null, { email: route.owner ?? '', name: route.shelterName ?? '', phone: route.phone ?? '' }) : void home(root);
  if (route.view === 'animales') return void renderListings(root, route.id, route.tab);
  if (route.view === 'animal') return void renderListingForm(root, route.id, route.petId, route.copyOf);
  if (route.view === 'solicitudes') return void renderInbox(root, route.id, route.tab);
  void home(root);
}

function signedOut(root: HTMLElement) {
  mount(
    root,
    html`
      <section class="portal" aria-labelledby="portal-title">
        <h1 class="page-title" id="portal-title" tabindex="-1" data-focus>${t('portal.title')}</h1>
        <p class="portal__lede">${t('portal.lede')}</p>
        ${steps()}
        <div class="portal-card"><p>${t('portal.signIn')}</p><div class="portal-card__auth" data-auth></div></div>
      </section>`,
  );
  renderAuth($('[data-auth]', root), { next: '/refugio', onSignedIn: (u) => toast(t('auth.signedIn', { who: u.name ?? u.email })) });
}

/** How it works, in three honest steps. */
const steps = () => html`
  <ol class="portal-steps">
    <li><strong>${t('portal.step1')}</strong><span>${t('portal.step1Body')}</span></li>
    <li><strong>${t('portal.step2')}</strong><span>${t('portal.step2Body')}</span></li>
    <li><strong>${t('portal.step3')}</strong><span>${t('portal.step3Body')}</span></li>
  </ol>`;

async function home(root: HTMLElement) {
  mount(root, html`<p class="loading-note" role="status">${t('portal.loading')}</p>`);
  let shelters: PortalShelter[] = [];
  let waiting = 0;
  try {
    shelters = await api.myShelters();
    if (state.user?.isAdmin) waiting = Object.values(await api.adminSummary()).reduce((a, n) => a + n, 0);
    // Where a request to be a shelter owner stands may have changed since the app opened (an admin decided).
    if (state.user && (!state.user.shelterOwner || state.user.listerRequest)) {
      const me = await api.me();
      const key = (u: { shelterOwner?: boolean; ownerRequest?: unknown; listerRequest?: unknown }) => JSON.stringify([u.shelterOwner, u.ownerRequest, u.listerRequest]);
      if (me && key(me) !== key(state.user)) return setUser(me); // redraws
    }
  } catch {
    return mount(root, html`<p class="loading-note" role="alert">${t('auth.err.network')}</p>`);
  }
  const owned = shelters.filter((s) => s.role === 'owner').length;
  mount(
    root,
    html`
      <section class="portal" aria-labelledby="portal-title">
        <h1 class="page-title" id="portal-title" tabindex="-1" data-focus>${t('portal.title')}</h1>
        <p class="portal__who">${t('portal.who', { who: state.user?.name ? `${state.user.name} · ${state.user.email}` : (state.user?.email ?? '') })}</p>
        ${state.user?.isAdmin
          ? html`<a class="portal-admin-link" href="/refugio/admin">${icon(ShieldCheck, 20)}<span>${t('admin.title')}</span>${waiting ? html`<span class="list-tabs__count">${waiting}</span>` : ''}</a>`
          : ''}
        ${shelters.length
          ? html`<ul class="portal-list">${shelters.map(shelterCard)}</ul>`
          : html`<p class="portal__lede">${t('portal.lede')}</p>${steps()}`}
        ${state.user?.shelterOwner
          ? owned < 3
            ? html`<a class="button ${shelters.length ? 'button--outline' : 'button--primary'} portal__new" href="/refugio/registro">${icon(Plus, 20)}${t('portal.register')}</a>`
            : ''
          : ownerCard()}
        ${shelters.some((s) => s.kind === 'private') ? '' : listerCard()}
      </section>`,
  );
  root.querySelector('[data-owner]')?.addEventListener('click', openOwnerRequest);
  root.querySelector('[data-lister]')?.addEventListener('click', openListerRequest);
  $$<HTMLButtonElement>('[data-review]', root).forEach((b) =>
    b.addEventListener('click', () => openReview(shelters.find((x) => x.id === b.dataset.review)!, () => void home(root))),
  );
  $$<HTMLButtonElement>('[data-donation]', root).forEach((b) => b.addEventListener('click', () => void openDonation(shelters.find((x) => x.id === b.dataset.donation)!, b)));
}

const DONATION_ERRORS = ['invalid_bank', 'invalid_account_type', 'invalid_account', 'invalid_holder', 'invalid_holder_id', 'not_for_private'];

/** The bank account adopters can donate to. Optional, and separate from registration; shown only while verified. */
async function openDonation(shelter: PortalShelter, opener: HTMLButtonElement) {
  opener.disabled = true;
  let d: Donation | null;
  try {
    d = (await api.shelter(shelter.id)).shelter.donation ?? null;
  } catch (err) {
    return toast(failText(err));
  } finally {
    opener.disabled = false;
  }
  const input = (name: string, label: Key, value: string | null | undefined, opts: { max: number; optional?: boolean; hint?: Key; inputmode?: string; placeholder?: string }) => html`
    <label class="field">
      <span class="field__label">${t(label)}${opts.optional ? html` <span class="muted">(${t('request.optional')})</span>` : ''}</span>
      <input class="field__input" name="${name}" maxlength="${opts.max}" value="${value ?? ''}" autocomplete="off" ${opts.inputmode ? html`inputmode="${opts.inputmode}"` : ''} ${opts.placeholder ? html`placeholder="${opts.placeholder}"` : ''} />
      ${opts.hint ? html`<span class="field__hint">${t(opts.hint)}</span>` : ''}
    </label>`;
  const dialog = openSheet(
    t('donation.portal.title', { name: shelter.name }),
    html`<form class="outcome__form" id="donation-form" novalidate>
      <p>${t('donation.portal.lede')}</p>
      ${input('bank', 'donation.bank', d?.bank, { max: 60, placeholder: t('donation.portal.bankPlaceholder') })}
      <fieldset class="question">
        <legend>${t('donation.accountType')}</legend>
        <div class="segmented">
          ${(['ahorros', 'corriente'] as const).map((k) => html`<label><input type="radio" name="accountType" value="${k}" ${d?.accountType === k ? 'checked' : ''} /><span>${t(`donation.type.${k}`)}</span></label>`)}
        </div>
      </fieldset>
      ${input('account', 'donation.account', d?.account, { max: 40, inputmode: 'numeric' })}
      ${input('holder', 'donation.holder', d?.holder, { max: 100, hint: 'donation.portal.holderHint' })}
      ${input('holderId', 'donation.holderId', d?.holderId, { max: 20, optional: true, inputmode: 'numeric', hint: 'donation.portal.holderIdHint' })}
      <label class="field">
        <span class="field__label">${t('donation.portal.note')} <span class="muted">(${t('request.optional')})</span></span>
        <textarea class="field__input field__input--area" name="note" rows="2" maxlength="300" placeholder="${t('donation.portal.notePlaceholder')}">${d?.note ?? ''}</textarea>
      </label>
      ${d ? html`<button class="text-button button--danger" type="button" data-remove>${t('donation.portal.remove')}</button>` : ''}
      <p class="form-error" role="alert" hidden data-error></p>
    </form>`,
    {
      footer: html`<button class="button button--ghost" type="button" data-cancel>${t('request.cancel')}</button>
        <button class="button button--primary" type="submit" form="donation-form" data-send>${t('donation.portal.save')}</button>`,
    },
  );
  const formEl = $<HTMLFormElement>('#donation-form', dialog);
  const error = $('[data-error]', dialog);
  const send = $<HTMLButtonElement>('[data-send]', dialog);
  const submit = async (remove: boolean) => {
    const f = new FormData(formEl);
    const v = (k: string) => (remove ? '' : String(f.get(k) ?? '').trim());
    send.disabled = true;
    error.hidden = true;
    try {
      const saved = await api.saveDonation(shelter.id, { bank: v('bank'), accountType: v('accountType'), account: v('account'), holder: v('holder'), holderId: v('holderId'), note: v('note') });
      closeSheet();
      toast(t(saved ? 'donation.portal.saved' : 'donation.portal.removed'));
    } catch (err) {
      const code = err instanceof ApiError ? err.code : '';
      error.textContent = DONATION_ERRORS.includes(code) ? t(`donation.err.${code as 'invalid_bank'}`) : failText(err);
      error.hidden = false;
      send.disabled = false;
    }
  };
  $('[data-cancel]', dialog).addEventListener('click', () => closeSheet());
  dialog.querySelector('[data-remove]')?.addEventListener('click', () => void submit(true));
  formEl.addEventListener('submit', (e) => {
    e.preventDefault();
    void submit(false);
  });
}

/** For a person with animals to rehome and no shelter: ask to list as a "Particular", or where the request stands. */
function listerCard(): Raw {
  const r = state.user?.listerRequest;
  if (!r) {
    return html`
      <section class="many bulk-prompt" aria-labelledby="lister-card-title">
        <h2 class="many__title" id="lister-card-title">${t('lister.card.title')}</h2>
        <p>${t('lister.card.body')}</p>
        <button class="button button--outline" type="button" data-lister>${t('lister.card.cta')}</button>
      </section>`;
  }
  return html`
    <section class="bulk-card bulk-card--${r.status}" aria-labelledby="lister-card-title" role="status">
      <h2 class="bulk-card__title" id="lister-card-title">${t(`lister.status.${r.status}`)}</h2>
      <p>${t(`lister.status.${r.status}.body`)}</p>
      ${r.note ? html`<p class="bulk-card__note"><strong>${t('bulk.status.reason')}:</strong> ${r.note}</p>` : ''}
      <p class="bulk-card__date">${t('request.sentOn', { date: formatDate(r.createdAt.slice(0, 10)) })}</p>
      ${r.status === 'declined' ? html`<button class="text-button" type="button" data-lister>${t('owner.again')}</button>` : ''}
    </section>`;
}

/** For someone not yet approved: ask for access, or where the request stands. */
function ownerCard(): Raw {
  const r = state.user?.ownerRequest;
  if (!r) {
    return html`
      <section class="many bulk-prompt" aria-labelledby="owner-card-title">
        <h2 class="many__title" id="owner-card-title">${t('owner.card.title')}</h2>
        <p>${t('owner.card.body')}</p>
        <button class="button button--primary" type="button" data-owner>${t('owner.card.cta')}</button>
      </section>`;
  }
  return html`
    <section class="bulk-card bulk-card--${r.status}" aria-labelledby="owner-card-title" role="status">
      <h2 class="bulk-card__title" id="owner-card-title">${t(`owner.status.${r.status as 'pending'}`)}</h2>
      <p>${t(`owner.status.${r.status as 'pending'}.body`, { shelter: r.shelterName })}</p>
      ${r.note ? html`<p class="bulk-card__note"><strong>${t('bulk.status.reason')}:</strong> ${r.note}</p>` : ''}
      <p class="bulk-card__date">${t('request.sentOn', { date: formatDate(r.createdAt.slice(0, 10)) })}</p>
      ${r.status === 'declined' ? html`<button class="text-button" type="button" data-owner>${t('owner.again')}</button>` : ''}
    </section>`;
}

/** Where a suspended shelter's request to lift it stands, and the button to ask (owners only). */
function reviewState(s: PortalShelter): Raw {
  const r = s.review;
  if (r?.status === 'pending') return html`<p class="muted">${t('review.pending', { date: formatDate(r.createdAt.slice(0, 10)) })}</p>`;
  const kept = r?.status === 'kept' ? html`<p>${t('review.kept', { date: formatDate((r.decidedAt ?? r.createdAt).slice(0, 10)) })}</p>${r.note ? html`<blockquote class="request-card__message">${r.note}</blockquote>` : ''}` : '';
  return html`${kept}${s.role === 'owner'
    ? html`<button class="button button--ink button--small" type="button" data-review="${s.id}">${t(kept ? 'review.again' : 'review.ask')}</button>`
    : html`<p class="muted">${t('review.ownerOnly')}</p>`}`;
}

/** The form to ask for a suspension to be lifted. */
function openReview(shelter: PortalShelter, done: () => void) {
  const dialog = openSheet(
    t('review.title', { name: shelter.name }),
    html`<form class="outcome__form" id="review-form" novalidate>
      <p>${t('review.lede')}</p>
      <label class="field">
        <span class="field__label">${t('review.label')}</span>
        <textarea class="field__input field__input--area" name="message" rows="6" maxlength="1500" required></textarea>
        <span class="field__hint">${t('review.hint')}</span>
      </label>
      <p class="form-error" role="alert" hidden data-error></p>
    </form>`,
    {
      footer: html`<button class="button button--ghost" type="button" data-cancel>${t('request.cancel')}</button>
        <button class="button button--primary" type="submit" form="review-form" data-send>${t('review.send')}</button>`,
    },
  );
  $('[data-cancel]', dialog).addEventListener('click', () => closeSheet());
  $<HTMLFormElement>('#review-form', dialog).addEventListener('submit', async (e) => {
    e.preventDefault();
    const message = String(new FormData(e.currentTarget as HTMLFormElement).get('message') ?? '').trim();
    const error = $('[data-error]', dialog);
    const send = $<HTMLButtonElement>('[data-send]', dialog);
    if (message.length < 30) return ((error.textContent = t('review.err.message_too_short')), (error.hidden = false));
    send.disabled = true;
    try {
      await api.requestReview(shelter.id, message);
      closeSheet();
      toast(t('review.sent'));
      done();
    } catch (err) {
      const code = err instanceof ApiError ? err.code : '';
      error.textContent = ['message_too_short', 'already_pending', 'too_many_reviews'].includes(code) ? t(`review.err.${code as 'already_pending'}`) : failText(err);
      error.hidden = false;
      send.disabled = false;
    }
  });
}

function shelterCard(s: PortalShelter): Raw {
  const animals = `/refugio/${encodeURIComponent(s.id)}/animales`;
  const mine = s.kind === 'private';
  const next: Record<ShelterStatus, Raw> = {
    pending: html`<p>${t('portal.pendingBody')}</p><a class="button button--outline button--small" href="${animals}">${t('listing.prepare')}</a>`,
    verified: html`
      <p>${t(mine ? 'lister.verifiedBody' : 'portal.verifiedBody')}</p>
      <div class="portal-card__actions">
        <a class="button button--primary button--small" href="/refugio/${encodeURIComponent(s.id)}/solicitudes">${t('inbox.open')}${s.newRequests ? html` <span class="portal-card__count">${s.newRequests}</span>` : ''}</a>
        <a class="button button--outline button--small" href="${animals}">${t('listing.open')}</a>
      </div>`,
    rejected: html`
      <p class="portal-card__reason"><strong>${t('portal.reason')}:</strong> ${s.statusReason ?? ''}</p>
      <div class="portal-card__actions">
        ${s.role === 'owner' ? html`<a class="button button--outline button--small" href="/refugio/${s.id}/editar">${t('portal.fix')}</a>` : ''}
        <a class="button button--ghost button--small" href="${animals}">${t('listing.prepare')}</a>
      </div>`,
    suspended: html`
      <p class="portal-card__reason"><strong>${t('portal.reason')}:</strong> ${s.statusReason ?? ''}</p>
      ${reviewState(s)}`,
  };
  return html`
    <li class="portal-card">
      <div class="portal-card__head">
        <span class="shelter__mark" aria-hidden="true">${icon(House, 22)}</span>
        <div>
          <h2 class="portal-card__name">${mine ? t('lister.myListings') : s.name}</h2>
          ${where(s.place)}
        </div>
        ${statusChip(s.status)}
      </div>
      ${next[s.status]}
      ${!mine && s.role === 'owner' && s.status !== 'suspended'
        ? html`<button class="text-button portal-card__donation" type="button" data-donation="${s.id}">${icon(HandHeart, 18)}${t('donation.portal.open')}</button>`
        : ''}
      ${mine ? '' : html`<p class="portal-card__role">${icon(Users, 15)}${t(`portal.role.${s.role}`)}${s.submittedAt ? html` · ${t('portal.sentOn', { date: formatDate(s.submittedAt.slice(0, 10)) })}` : ''}</p>`}
    </li>`;
}

// ---------- Registration (and correcting a rejected application) ----------

async function edit(root: HTMLElement, id: string) {
  mount(root, html`<p class="loading-note" role="status">${t('portal.loading')}</p>`);
  try {
    const { shelter, application } = await api.shelter(id);
    if (shelter.role !== 'owner' || !application) throw new ApiError('not_found', {});
    form(root, { shelter, application });
  } catch {
    mount(root, html`<section class="portal"><p class="loading-note" role="alert">${t('portal.notFound')}</p><a class="button button--outline" href="/refugio">${t('portal.back')}</a></section>`);
  }
}

/** `behalf`: an admin registering a shelter for its owner, with what the owner told them (prefills the form). */
function form(root: HTMLElement, existing: { shelter: PortalShelter; application: ShelterApplication } | null, behalf?: { email: string; name: string; phone: string }) {
  const s = existing?.shelter;
  const a = existing?.application;
  let place: Place | null = s?.place ?? null;
  const field = (name: string, label: Key, opts: { value?: string | null; type?: string; required?: boolean; hint?: Key; area?: boolean; max?: number; auto?: string; inputmode?: string } = {}) => html`
    <label class="field">
      <span class="field__label">${t(label)}${opts.required ? '' : html` <span class="muted">(${t('request.optional')})</span>`}</span>
      ${opts.area
        ? html`<textarea class="field__input field__input--area" name="${name}" rows="4" maxlength="${opts.max ?? 600}">${opts.value ?? ''}</textarea>`
        : html`<input class="field__input" name="${name}" type="${opts.type ?? 'text'}" maxlength="${opts.max ?? 120}" value="${opts.value ?? ''}" ${opts.auto ? html`autocomplete="${opts.auto}"` : ''} ${opts.inputmode ? html`inputmode="${opts.inputmode}"` : ''} />`}
      ${opts.hint ? html`<span class="field__hint">${t(opts.hint)}</span>` : ''}
    </label>`;
  mount(
    root,
    html`
      <section class="portal" aria-labelledby="portal-title">
        <a class="text-button portal__back" href="${behalf ? '/refugio/admin/duenos' : '/refugio'}">${t('portal.back')}</a>
        <h1 class="page-title" id="portal-title" tabindex="-1" data-focus>${behalf ? t('owners.register.title') : existing ? t('portal.fixTitle', { name: s!.name }) : t('portal.registerTitle')}</h1>
        ${behalf ? html`<p class="portal__lede">${t('owners.register.lede')}</p>` : ''}
        ${s?.statusReason ? html`<p class="withdraw-warning"><strong>${t('portal.reason')}:</strong> ${s.statusReason}</p>` : ''}
        <form class="portal-form" id="shelter-form" novalidate>
          ${behalf
            ? html`<fieldset class="form-section">
                <legend class="section-title">${t('owners.register.owner')}</legend>
                <label class="field">
                  <span class="field__label">${t('owners.register.email')}</span>
                  <input class="field__input" name="ownerEmail" type="email" maxlength="254" value="${behalf.email}" autocomplete="off" required />
                  <span class="field__hint">${t('owners.register.emailHint')}</span>
                </label>
              </fieldset>`
            : ''}
          <fieldset class="form-section">
            <legend class="section-title">${t('portal.form.public')}</legend>
            <p class="muted">${t('portal.form.publicNote')}</p>
            ${field('name', 'portal.form.name', { value: s?.name ?? behalf?.name, required: true, max: 80, auto: 'organization' })}
            <div class="field">
              <span class="field__label" id="place-label">${t('portal.form.place')}</span>
              <div class="place-pick" data-place-pick>
                <input class="field__input" type="search" autocomplete="off" placeholder="${t('place.searchPlaceholder')}" aria-labelledby="place-label" aria-describedby="place-chosen" value="${place?.name ?? ''}" data-place-query />
                <ul class="place-pick__results" role="listbox" aria-labelledby="place-label" data-place-results hidden></ul>
                <p class="field__hint" id="place-chosen" data-place-chosen>${place ? t('portal.form.placeChosen', { place: `${place.name}, ${place.municipality}` }) : t('portal.form.placeHint')}</p>
              </div>
            </div>
            ${field('description', 'portal.form.description', { value: s?.description, area: true, max: 600 })}
            ${field('visitHours', 'portal.form.visitHours', { value: s?.visitHours, hint: 'portal.form.visitHoursHint' })}
            ${field('publicPhone', 'portal.form.publicPhone', { value: showPhone(s?.publicPhone), type: 'tel', inputmode: 'tel', auto: 'tel-national' })}
            ${field('email', 'portal.form.email', { value: s?.email, type: 'email', auto: 'email' })}
            ${field('website', 'portal.form.website', { value: s?.website, type: 'url', hint: 'portal.form.websiteHint' })}
          </fieldset>
          <fieldset class="form-section form-section--private">
            <legend class="section-title">${t('portal.form.private')}</legend>
            <p class="muted">${t('portal.form.privateNote')}</p>
            ${field('contactName', 'portal.form.contactName', { value: a?.contactName, required: true, max: 80, auto: 'name' })}
            ${field('contactPhone', 'portal.form.contactPhone', { value: showPhone(a?.contactPhone) || showPhone(behalf?.phone), required: true, type: 'tel', inputmode: 'tel', auto: 'tel-national', hint: 'portal.form.contactPhoneHint' })}
            ${field('address', 'portal.form.address', { value: a?.address, required: true, max: 300, hint: 'portal.form.addressHint' })}
            ${field('rnc', 'portal.form.rnc', { value: a?.rnc, max: 40 })}
            ${field('social', 'portal.form.social', { value: a?.social.join('\n'), area: true, max: 1000, hint: 'portal.form.socialHint' })}
            ${field('history', 'portal.form.history', { value: a?.history, required: true, area: true, max: 2000, hint: 'portal.form.historyHint' })}
            <div class="form-subsection">
              <h3 class="form-subsection__title">${t('portal.form.reference')}</h3>
              <p class="muted">${t('portal.form.referenceNote')}</p>
              <div class="references" data-refs></div>
              <button class="text-button references__add" type="button" data-add-ref>${icon(Plus, 18)}${t('portal.form.addReference')}</button>
            </div>
          </fieldset>
          <label class="consent">
            <input type="checkbox" name="rules" />
            <span>${t(behalf ? 'owners.register.rules' : 'portal.form.rules')}</span>
          </label>
          <p class="form-error" role="alert" hidden data-error></p>
          <button class="button button--primary portal-form__send" type="submit" data-send>${behalf ? t('owners.register.send') : existing ? t('portal.form.resend') : t('portal.form.send')}</button>
        </form>
      </section>`,
  );

  // References: the first is required; up to two more, each with a "Quitar". The list is kept here and
  // redrawn on add or remove, keeping whatever has been typed.
  type Ref = { name: string; contact: string; kind: ReferenceKind | '' };
  let refs: Ref[] = a?.references.length ? a.references.map((r) => ({ ...r })) : [{ name: '', contact: '', kind: '' }];
  const refsRoot = $('[data-refs]', root);
  const addRef = $<HTMLButtonElement>('[data-add-ref]', root);
  const readRefs = () =>
    (refs = $$<HTMLElement>('[data-ref]', refsRoot).map((el, i) => ({
      name: $<HTMLInputElement>('input[name^=ref-name]', el).value.trim(),
      contact: $<HTMLInputElement>('input[name^=ref-contact]', el).value.trim(),
      kind: (el.querySelector<HTMLInputElement>(`input[name=ref-kind-${i}]:checked`)?.value ?? '') as Ref['kind'],
    })));
  const drawRefs = () => {
    mount(
      refsRoot,
      html`${refs.map(
        (r, i) => html`
          <div class="reference" data-ref>
            ${i > 0
              ? html`<div class="reference__head"><span class="reference__title">${t('portal.form.referenceN', { n: i + 1 })} <span class="muted">(${t('request.optional')})</span></span><button class="text-button" type="button" data-remove-ref="${i}">${t('portal.form.removeReference')}</button></div>`
              : ''}
            <label class="field"><span class="field__label">${t('portal.form.referenceName')}</span><input class="field__input" name="ref-name-${i}" maxlength="80" value="${r.name}" /></label>
            <label class="field"><span class="field__label">${t('portal.form.referenceContact')}</span><input class="field__input" name="ref-contact-${i}" maxlength="120" value="${r.contact}" /></label>
            <fieldset class="question">
              <legend>${t('portal.form.referenceKind')}</legend>
              <div class="segmented segmented--wrap">
                ${(['veterinaria', 'refugio', 'otro'] as const).map((k) => html`<label><input type="radio" name="ref-kind-${i}" value="${k}" ${r.kind === k ? 'checked' : ''} /><span>${t(`portal.form.kind.${k}`)}</span></label>`)}
              </div>
            </fieldset>
          </div>`,
      )}`,
    );
    addRef.hidden = refs.length >= 3;
    $$<HTMLButtonElement>('[data-remove-ref]', refsRoot).forEach((b) =>
      b.addEventListener('click', () => {
        readRefs();
        refs.splice(Number(b.dataset.removeRef), 1);
        drawRefs();
        addRef.focus();
      }),
    );
  };
  drawRefs();
  addRef.addEventListener('click', () => {
    readRefs();
    refs.push({ name: '', contact: '', kind: '' });
    drawRefs();
    $$<HTMLInputElement>('input[name^=ref-name]', refsRoot).at(-1)?.focus();
  });

  // The area: a place search like the adopter's, without coordinates leaving the device. Choosing a result
  // puts its name in the field (the hint below names the municipality, which tells apart places with the
  // same name); editing the field afterwards clears the choice until another is picked, so the
  // field never shows a zone that isn't actually selected.
  const query = $<HTMLInputElement>('[data-place-query]', root);
  const results = $<HTMLUListElement>('[data-place-results]', root);
  const chosen = $('[data-place-chosen]', root);
  const labelOf = (p: Place) => `${p.name}, ${p.municipality}`;
  const showChoice = () => (chosen.textContent = place ? t('portal.form.placeChosen', { place: labelOf(place) }) : t('portal.form.placeHint'));
  let timer = 0;
  query.addEventListener('input', () => {
    if (place && query.value !== place.name) (place = null), showChoice();
    clearTimeout(timer);
    const q = query.value.trim();
    if (q.length < 2) return void (results.hidden = true);
    timer = window.setTimeout(async () => {
      const found = await api.searchPlaces(q).catch(() => [] as Place[]);
      mount(results, html`${found.slice(0, 6).map((p, i) => html`<li role="option"><button type="button" data-place="${i}"><strong>${p.name}</strong> <span class="muted">${p.municipality}, ${p.province}</span></button></li>`)}`);
      results.hidden = !found.length;
      $$<HTMLButtonElement>('[data-place]', results).forEach((b) =>
        b.addEventListener('click', () => {
          place = found[Number(b.dataset.place)];
          query.value = place.name; // the hint below gives the full "Zona elegida: …, municipio"
          showChoice();
          results.hidden = true;
          query.focus();
        }),
      );
    }, 200);
  });
  query.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !results.hidden) (e.preventDefault(), (results.hidden = true));
  });

  const formEl = $<HTMLFormElement>('#shelter-form', root);
  const error = $('[data-error]', root);
  const send = $<HTMLButtonElement>('[data-send]', root);
  formEl.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(formEl);
    const v = (k: string) => String(f.get(k) ?? '').trim();
    const body: ShelterForm = {
      name: v('name'),
      placeId: place?.id ?? '',
      description: v('description'),
      visitHours: v('visitHours'),
      publicPhone: v('publicPhone'),
      email: v('email'),
      website: v('website'),
      contactName: v('contactName'),
      contactPhone: v('contactPhone'),
      rnc: v('rnc'),
      address: v('address'),
      social: v('social').split(/\s+/).filter(Boolean),
      history: v('history'),
      // Extra references left completely blank are dropped, not sent as errors.
      references: readRefs().filter((r, i) => i === 0 || r.name || r.contact || r.kind),
      rules: f.get('rules') === 'on',
    };
    send.disabled = true;
    error.hidden = true;
    try {
      if (behalf) {
        await api.adminRegisterShelter(v('ownerEmail'), body);
        toast(t('owners.register.done', { email: v('ownerEmail') }));
        return navigate('/refugio/admin/duenos');
      }
      if (existing) await api.resubmitShelter(existing.shelter.id, body);
      else await api.registerShelter(body);
      toast(existing ? t('portal.resent') : t('portal.sent'));
      navigate('/refugio');
    } catch (err) {
      const code = err instanceof ApiError ? err.code : 'network';
      const known = ['invalid_more_reference', 'invalid_name', 'invalid_place', 'invalid_contact', 'invalid_phone', 'invalid_public_phone', 'invalid_email', 'invalid_address', 'history_too_short', 'invalid_reference', 'rules_required', 'too_many_shelters', 'not_editable', 'too_many_today', 'queue_full', 'owner_approval_required', 'invalid_owner_email'];
      error.textContent = known.includes(code) ? t(`portal.err.${code as 'invalid_name'}`) : failText(code);
      error.hidden = false;
      error.scrollIntoView({ block: 'center', behavior: 'smooth' });
      send.disabled = false;
    }
  });
}

// ---------- The admin console ----------

type AdminCounts = { shelters: number; owners: number; bulk: number; paused: number; reports: number };
type Queue = keyof AdminCounts;
const QUEUES: Queue[] = ['owners', 'shelters', 'reports', 'bulk', 'paused'];
const ADMIN_PATH: Record<Queue, string> = {
  owners: '/refugio/admin/duenos',
  shelters: '/refugio/admin/refugios',
  reports: '/refugio/admin/reportes',
  bulk: '/refugio/admin/grandes',
  paused: '/refugio/admin/pausa',
};
const ADMIN_ICON = { owners: UserCheck, shelters: House, reports: Flag, bulk: UsersRound, paused: CirclePause } as const;

/** The same tabs on every queue, each with how many are waiting, to move between them in one tap. */
const adminNav = (current: Queue, counts: AdminCounts): Raw => html`
  <nav class="list-tabs admin-nav" aria-label="${t('admin.title')}">
    ${QUEUES.map(
      (k) => html`<a class="list-tabs__tab" href="${ADMIN_PATH[k]}" aria-current="${k === current ? 'page' : 'false'}">${t(`admin.nav.${k}`)}${counts[k] ? html` <span class="list-tabs__count">${counts[k]}</span>` : ''}</a>`,
    )}
  </nav>`;

/** The front page: what is waiting for an answer, one card per queue, and the admin's tools. */
async function adminHub(root: HTMLElement) {
  if (!state.user?.isAdmin) return mount(root, html`<section class="portal"><p class="loading-note">${t('portal.notFound')}</p></section>`);
  mount(root, html`<p class="loading-note" role="status">${t('portal.loading')}</p>`);
  let counts: AdminCounts;
  try {
    counts = await api.adminSummary();
  } catch {
    return mount(root, html`<p class="loading-note" role="alert">${t('auth.err.network')}</p>`);
  }
  const card = (k: Queue) => html`
    <li>
      <a class="admin-card" href="${ADMIN_PATH[k]}">
        <span class="shelter__mark" aria-hidden="true">${icon(ADMIN_ICON[k], 22)}</span>
        <span class="admin-card__text">
          <strong class="admin-card__title">${t(`admin.card.${k}.title`)}</strong>
          <span class="muted">${t(`admin.card.${k}`)}</span>
        </span>
        <span class="admin-card__count ${counts[k] ? 'admin-card__count--waiting' : ''}">${counts[k] ? t('admin.count.some', { n: counts[k] }) : t('admin.count.none')}</span>
      </a>
    </li>`;
  mount(
    root,
    html`
      <section class="portal portal--admin" aria-labelledby="portal-title">
        <a class="text-button portal__back" href="/refugio">${t('portal.back')}</a>
        <h1 class="page-title" id="portal-title" tabindex="-1" data-focus>${t('admin.title')}</h1>
        <p class="portal__lede">${t('admin.lede')}</p>
        <ul class="admin-cards">${QUEUES.map(card)}</ul>
        <h2 class="section-title">${t('admin.tools')}</h2>
        <div class="admin-tools">
          <a class="button button--outline button--small" href="/refugio/admin/registrar">${icon(Plus, 16)}${t('owners.admin.registerLink')}</a>
          <a class="button button--outline button--small" href="/refugio/admin/adoptantes">${icon(BadgeCheck, 16)}${t('admin.adoptersLink')}</a>
          <div class="portal-digest">
            <button class="button button--outline button--small" type="button" data-digest>${t('portal.admin.digest')}</button>
            <p class="muted">${t('portal.admin.digestNote')}</p>
          </div>
        </div>
      </section>`,
  );
  root.querySelector<HTMLButtonElement>('[data-digest]')?.addEventListener('click', async (e) => {
    const b = e.currentTarget as HTMLButtonElement;
    b.disabled = true;
    try {
      const r = await api.runDigest();
      toast(t('portal.admin.digestDone', { digests: r.digestEmails, alerts: r.alertEmails, closed: r.closedEmails }) + (r.deferred ? t('portal.admin.digestDeferred') : ''));
    } catch (err) {
      toast(failText(err));
    }
    b.disabled = false;
  });
}

// ---------- Verification queue (admins) ----------

const QUEUE: ShelterStatus[] = ['pending', 'verified', 'rejected', 'suspended'];

async function adminQueue(root: HTMLElement, status: ShelterStatus) {
  if (!state.user?.isAdmin) return mount(root, html`<section class="portal"><p class="loading-note">${t('portal.notFound')}</p></section>`);
  mount(root, html`<p class="loading-note" role="status">${t('portal.loading')}</p>`);
  let shelters: AdminShelter[];
  let pendingReviews: number;
  let counts: AdminCounts;
  try {
    [{ shelters, pendingReviews }, counts] = await Promise.all([api.adminShelters(status), api.adminSummary()]);
  } catch {
    return mount(root, html`<p class="loading-note" role="alert">${t('auth.err.network')}</p>`);
  }
  mount(
    root,
    html`
      <section class="portal portal--admin" aria-labelledby="portal-title">
        <a class="text-button portal__back" href="/refugio/admin">${t('admin.title')}</a>
        <h1 class="page-title" id="portal-title" tabindex="-1" data-focus>${t('portal.admin.title')}</h1>
        ${adminNav('shelters', counts)}
        <nav class="list-tabs list-tabs--sub" aria-label="${t('portal.admin.title')}">
          ${QUEUE.map((s) => html`<a class="list-tabs__tab" href="/refugio/admin/refugios?estado=${s}" aria-current="${s === status ? 'page' : 'false'}">${t(`portal.admin.tab.${s}`)}</a>`)}
        </nav>
        ${pendingReviews && status !== 'suspended'
          ? html`<a class="portal-card__reason admin-review-pointer" href="/refugio/admin/refugios?estado=suspended">${t(pendingReviews === 1 ? 'review.admin.pointer1' : 'review.admin.pointerN', { n: pendingReviews })}</a>`
          : ''}
        ${shelters.length ? html`<ul class="portal-list">${shelters.map(adminCard)}</ul>` : html`<p class="passed__empty">${t('portal.admin.empty')}</p>`}
      </section>`,
  );
  $$<HTMLFormElement>('[data-fee-cap]', root).forEach((f) =>
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const raw = String(new FormData(f).get('cap') ?? '').trim();
      $$<HTMLButtonElement>('button', f).forEach((b) => (b.disabled = true));
      try {
        const r = await api.adminFeeCap(f.dataset.feeCap!, raw === '' ? null : Number(raw));
        toast(t('fee.admin.done', { cap: pesos(r.shelter.feeCapDop) }));
        void adminQueue(root, status);
      } catch (err) {
        $$<HTMLButtonElement>('button', f).forEach((b) => (b.disabled = false));
        toast(failText(err));
      }
    }),
  );
  $$<HTMLFormElement>('[data-decide]', root).forEach((f) =>
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const submitter = (e as SubmitEvent).submitter as HTMLButtonElement | null;
      const action = submitter?.value as 'verify' | 'reject' | 'suspend' | 'keep';
      const reason = String(new FormData(f).get('reason') ?? '').trim();
      if (action !== 'verify' && !reason) {
        const box = $<HTMLTextAreaElement>('textarea[name=reason]', f);
        box.closest<HTMLElement>('.field')!.hidden = false;
        box.focus();
        return toast(t('portal.admin.needReason'));
      }
      $$<HTMLButtonElement>('button', f).forEach((b) => (b.disabled = true));
      try {
        if (action === 'keep') await api.adminKeepSuspension(f.dataset.decide!, reason);
        else await api.adminDecision(f.dataset.decide!, action, reason || undefined);
        toast(t(action === 'keep' ? 'review.admin.kept' : `portal.admin.done.${action}`));
        void adminQueue(root, status);
      } catch (err) {
        $$<HTMLButtonElement>('button', f).forEach((b) => (b.disabled = false));
        toast(failText(err));
      }
    }),
  );
}

// ---------- Listings under review: reports and money language (admins) ----------

async function adminReportsQueue(root: HTMLElement) {
  if (!state.user?.isAdmin) return mount(root, html`<section class="portal"><p class="loading-note">${t('portal.notFound')}</p></section>`);
  mount(root, html`<p class="loading-note" role="status">${t('portal.loading')}</p>`);
  let pets: AdminReviewPet[];
  let counts: AdminCounts;
  try {
    [pets, counts] = await Promise.all([api.adminReports(), api.adminSummary()]);
  } catch {
    return mount(root, html`<p class="loading-note" role="alert">${t('auth.err.network')}</p>`);
  }
  mount(
    root,
    html`
      <section class="portal portal--admin" aria-labelledby="portal-title">
        <a class="text-button portal__back" href="/refugio/admin">${t('admin.title')}</a>
        <h1 class="page-title" id="portal-title" tabindex="-1" data-focus>${t('reports.admin.title')}</h1>
        ${adminNav('reports', counts)}
        <p class="portal__lede">${t('reports.admin.lede')}</p>
        ${pets.length ? html`<ul class="portal-list">${pets.map(reviewCard)}</ul>` : html`<p class="passed__empty">${t('reports.admin.empty')}</p>`}
      </section>`,
  );
  $$<HTMLFormElement>('[data-review-pet]', root).forEach((f) =>
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const action = ((e as SubmitEvent).submitter as HTMLButtonElement | null)?.value as 'restore' | 'takedown';
      const note = String(new FormData(f).get('note') ?? '').trim();
      if (action === 'takedown' && !note) {
        $<HTMLTextAreaElement>('textarea[name=note]', f).focus();
        return toast(t('portal.admin.needReason'));
      }
      $$<HTMLButtonElement>('button', f).forEach((b) => (b.disabled = true));
      try {
        if (action === 'restore') await api.adminRestorePet(f.dataset.reviewPet!, note || undefined);
        else await api.adminTakedownPet(f.dataset.reviewPet!, note);
        toast(t(action === 'restore' ? 'reports.admin.restored' : 'reports.admin.takenDown'));
        void adminReportsQueue(root);
      } catch (err) {
        $$<HTMLButtonElement>('button', f).forEach((b) => (b.disabled = false));
        toast(failText(err));
      }
    }),
  );
}

function reviewCard(p: AdminReviewPet): Raw {
  const hidden = p.status === 'in_review';
  const why = !p.review
    ? hidden && !p.reports.length
      ? t('reports.admin.hiddenOther') // in review for another reason, e.g. a private lister's first listing
      : t(p.reports.length === 1 ? 'reports.admin.reported1' : 'reports.admin.reportedN', { n: p.reports.length })
    : p.review.reason === 'dinero'
      ? t('reports.admin.money', { words: p.review.words.map((w) => `«${w}»`).join(', ') })
      : t('reports.admin.hiddenByReports', { n: p.reports.length });
  return html`
    <li class="portal-card">
      <div class="portal-card__head">
        <span class="mini-frame mini-frame--sm" data-frame="${frameFor(p.id)}">${photo({ id: p.id, photo: p.photo } as PetSummary, 'lazy', true)}</span>
        <div>
          <h2 class="portal-card__name">${p.name}</h2>
          <span class="portal-card__place">${p.shelter?.name ?? t('lister.private')}</span>
        </div>
        <span class="status-chip ${hidden ? 'status-chip--suspended' : 'status-chip--pending'}">${icon(hidden ? EyeOff : Flag, 16)}${t(hidden ? 'reports.admin.hidden' : 'reports.admin.live')}</span>
      </div>
      <p class="portal-card__reason">${why}</p>
      ${p.reports.length
        ? html`<ul class="review-reports">${p.reports.map(
            (r) => html`<li><strong>${t(`report.reason.${r.reason}`)}</strong>${r.details ? html` «${r.details}»` : ''} <span class="muted">· ${formatDate(r.at.slice(0, 10))}${r.by ? ` · ${r.by}` : ''}</span></li>`,
          )}</ul>`
        : ''}
      <details class="review-text">
        <summary>${t('reports.admin.text')}</summary>
        <p>${p.story}</p>
        ${p.needs.length ? html`<p class="muted">${p.needs.join(' · ')}</p>` : ''}
      </details>
      ${p.openRequests ? html`<p class="muted">${t(p.openRequests === 1 ? 'reports.admin.requests1' : 'reports.admin.requestsN', { n: p.openRequests })}</p>` : ''}
      <form class="portal-decide" data-review-pet="${p.id}">
        <label class="field">
          <span class="field__label">${t('reports.admin.noteLabel')}</span>
          <textarea class="field__input field__input--area" name="note" rows="2" maxlength="500" placeholder="${t('reports.admin.notePlaceholder')}"></textarea>
        </label>
        <div class="portal-decide__actions">
          <button class="button button--primary button--small" type="submit" value="restore">${icon(Eye, 16)}${t(hidden ? 'reports.admin.restore' : 'reports.admin.dismiss')}</button>
          <button class="button button--outline button--danger button--small" type="submit" value="takedown">${icon(EyeOff, 16)}${t('reports.admin.takedown')}</button>
        </div>
        ${p.shelter ? html`<a class="text-button" href="/refugio/admin/refugios?estado=verified">${t('reports.admin.shelterLink', { name: p.shelter.name ?? '' })}</a>` : ''}
      </form>
    </li>`;
}

// ---------- The rules for listing (PAT-16), before someone's first animal ----------

const RULES = ['rules.sales', 'rules.fee', 'rules.breeding', 'rules.age', 'rules.text', 'rules.honest'] as const;

function rulesPage(root: HTMLElement, next: string | null) {
  // Back into the portal only: never an outside address.
  const to = next && next.startsWith('/refugio/') ? next : '/refugio';
  mount(
    root,
    html`
      <section class="portal rules" aria-labelledby="portal-title">
        <a class="text-button portal__back" href="/refugio">${t('portal.back')}</a>
        <h1 class="page-title" id="portal-title" tabindex="-1" data-focus>${t('rules.title')}</h1>
        <p class="portal__lede">${t('rules.lede')}</p>
        <ol class="rules__list">${RULES.map((k) => html`<li><strong>${t(`${k}.title`)}</strong> ${t(k, { cap: pesos(2000) })}</li>`)}</ol>
        <p class="portal-card__reason">${t('rules.enforced')}</p>
        <button class="button button--primary" type="button" data-accept>${t('rules.accept')}</button>
      </section>`,
  );
  $<HTMLButtonElement>('[data-accept]', root).addEventListener('click', async (e) => {
    const b = e.currentTarget as HTMLButtonElement;
    b.disabled = true;
    try {
      await api.acceptListerRules();
      if (state.user) setUser({ ...state.user, listerRules: true });
      navigate(to);
    } catch (err) {
      b.disabled = false;
      toast(failText(err));
    }
  });
}

// ---------- Adopters whose requests are paused (admins) ----------

async function adminPausedQueue(root: HTMLElement) {
  if (!state.user?.isAdmin) return mount(root, html`<section class="portal"><p class="loading-note">${t('portal.notFound')}</p></section>`);
  mount(root, html`<p class="loading-note" role="status">${t('portal.loading')}</p>`);
  let list: AdminPaused[];
  let counts: AdminCounts;
  try {
    [list, counts] = await Promise.all([api.adminPaused(), api.adminSummary()]);
  } catch {
    return mount(root, html`<p class="loading-note" role="alert">${t('auth.err.network')}</p>`);
  }
  mount(
    root,
    html`
      <section class="portal portal--admin" aria-labelledby="portal-title">
        <a class="text-button portal__back" href="/refugio/admin">${t('admin.title')}</a>
        <h1 class="page-title" id="portal-title" tabindex="-1" data-focus>${t('paused.title')}</h1>
        ${adminNav('paused', counts)}
        <p class="portal__lede">${t('paused.lede')}</p>
        ${list.length ? html`<ul class="portal-list">${list.map(pausedCard)}</ul>` : html`<p class="passed__empty">${t('paused.empty')}</p>`}
      </section>`,
  );
  $$<HTMLFormElement>('[data-clear-pause]', root).forEach((f) =>
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const note = String(new FormData(f).get('note') ?? '').trim();
      $$<HTMLButtonElement>('button', f).forEach((b) => (b.disabled = true));
      try {
        await api.adminClearPause(f.dataset.clearPause!, note || undefined);
        toast(t('paused.done'));
        void adminPausedQueue(root);
      } catch (err) {
        $$<HTMLButtonElement>('button', f).forEach((b) => (b.disabled = false));
        toast(failText(err));
      }
    }),
  );
}

function pausedCard(r: AdminPaused): Raw {
  const row = (label: Key, value: Raw | string | null | undefined) => (value ? html`<div><dt>${t(label)}</dt><dd>${value}</dd></div>` : '');
  const who = r.who.name ?? r.who.email;
  return html`
    <li class="portal-card">
      <div class="portal-card__head">
        <span class="shelter__mark" aria-hidden="true">${icon(CirclePause, 22)}</span>
        <div>
          <h2 class="portal-card__name">${who}</h2>
          <span class="portal-card__place">${t('paused.since', { date: formatDate(r.since.slice(0, 10)) })}</span>
        </div>
      </div>
      <dl class="portal-facts">
        ${row('owners.admin.contact', html`${emailParts(r.who.email)}${r.who.phone ? html`<br /><a href="${waLink(r.who.phone)}" target="_blank" rel="noopener">${icon(MessageCircle, 15)} ${showPhone(r.who.phone)}</a>` : ''}`)}
        ${row(
          'paused.withdrew',
          html`${r.withdrawals.map(
            (w) => html`<span class="paused__item">${w.pet}${w.shelter ? ` · ${w.shelter}` : ''}${w.reason ? html` <span class="muted">«${t(`request.withdraw.${w.reason as 'otro'}`)}»</span>` : ''} <span class="muted">· ${formatDate(w.at.slice(0, 10))}</span></span>`,
          )}`,
        )}
        ${row('paused.open', String(r.open))}
        ${row('bulk.admin.adopted', String(r.adopted))}
      </dl>
      <form class="portal-decide" data-clear-pause="${r.id}">
        <label class="field">
          <span class="field__label">${t('paused.noteLabel')}</span>
          <textarea class="field__input field__input--area" name="note" rows="2" maxlength="500" placeholder="${t('paused.notePlaceholder')}"></textarea>
        </label>
        <div class="portal-decide__actions">
          <button class="button button--primary button--small" type="submit">${icon(BadgeCheck, 16)}${t('paused.clear')}</button>
        </div>
      </form>
    </li>`;
}

// ---------- Verified adopters (admins, PAT-2) ----------

/** Look someone up by their account email and give or take back "Verificado por Patiamor"; below, everyone
 *  who has it. The email lives in the address (?correo=), so a re-render keeps the person on screen. */
async function adminAdopters(root: HTMLElement, email: string | null) {
  if (!state.user?.isAdmin) return mount(root, html`<section class="portal"><p class="loading-note">${t('portal.notFound')}</p></section>`);
  mount(root, html`<p class="loading-note" role="status">${t('portal.loading')}</p>`);
  let found: AdminAdopter | null = null;
  let list: AdminAdopter[];
  try {
    [found, list] = await Promise.all([email ? api.adminFindAdopter(email).catch(() => null) : Promise.resolve(null), api.adminAdopters()]);
  } catch {
    return mount(root, html`<p class="loading-note" role="alert">${t('auth.err.network')}</p>`);
  }
  const others = list.filter((a) => a.id !== found?.id);
  mount(
    root,
    html`
      <section class="portal portal--admin" aria-labelledby="portal-title">
        <a class="text-button portal__back" href="/refugio/admin">${t('admin.title')}</a>
        <h1 class="page-title" id="portal-title" tabindex="-1" data-focus>${t('verified.title')}</h1>
        <p class="portal__lede">${t('verified.lede')}</p>
        <form class="adopter-find" data-find role="search">
          <label class="field">
            <span class="field__label">${t('verified.findLabel')}</span>
            <input class="field__input" type="email" name="email" inputmode="email" autocomplete="off" required value="${email ?? ''}" />
          </label>
          <button class="button button--primary button--small" type="submit">${t('verified.find')}</button>
        </form>
        ${email ? (found ? html`<ul class="portal-list">${adopterCard(found)}</ul>` : html`<p class="passed__empty">${t('verified.notFound')}</p>`) : ''}
        <h2 class="section-title">${t('verified.listTitle')}</h2>
        ${others.length ? html`<ul class="portal-list">${others.map(adopterCard)}</ul>` : list.length ? '' : html`<p class="passed__empty">${t('verified.empty')}</p>`}
      </section>`,
  );
  $('[data-find]', root).addEventListener('submit', (e) => {
    e.preventDefault();
    const value = String(new FormData(e.currentTarget as HTMLFormElement).get('email') ?? '').trim();
    navigate(`/refugio/admin/adoptantes?correo=${encodeURIComponent(value)}`);
  });
  $$<HTMLFormElement>('[data-adopter]', root).forEach((f) =>
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const note = String(new FormData(f).get('note') ?? '').trim();
      const giving = f.dataset.action === 'verify';
      if (giving && !note) {
        $<HTMLTextAreaElement>('textarea[name=note]', f).focus();
        return toast(t('verified.needNote'));
      }
      $$<HTMLButtonElement>('button', f).forEach((b) => (b.disabled = true));
      try {
        if (giving) await api.adminVerifyAdopter(f.dataset.adopter!, note);
        else await api.adminUnverifyAdopter(f.dataset.adopter!, note || undefined);
        toast(t(giving ? 'verified.doneGive' : 'verified.doneRemove'));
        void adminAdopters(root, email);
      } catch (err) {
        $$<HTMLButtonElement>('button', f).forEach((b) => (b.disabled = false));
        toast(failText(err));
      }
    }),
  );
}

function adopterCard(a: AdminAdopter): Raw {
  const row = (label: Key, value: Raw | string | null | undefined) => (value ? html`<div><dt>${t(label)}</dt><dd>${value}</dd></div>` : '');
  const v = a.verified;
  return html`
    <li class="portal-card">
      <div class="portal-card__head">
        <span class="shelter__mark" aria-hidden="true">${icon(v ? BadgeCheck : UserCheck, 22)}</span>
        <div>
          <h2 class="portal-card__name">${a.who.name ?? a.who.email}</h2>
          <span class="portal-card__place">${t('verified.since', { date: formatDate(a.since.slice(0, 10)) })}</span>
        </div>
      </div>
      <dl class="portal-facts">
        ${row('owners.admin.contact', html`${emailParts(a.who.email)}${a.who.phone ? html`<br /><a href="${waLink(a.who.phone)}" target="_blank" rel="noopener">${icon(MessageCircle, 15)} ${showPhone(a.who.phone)}</a>` : ''}`)}
        ${row('verified.requests', t('verified.requestsValue', { open: a.requests.open, adopted: a.requests.adopted, withdrawn: a.requests.withdrawn90 }))}
      </dl>
      ${v
        ? html`
            <p class="verified-badge">${icon(BadgeCheck, 15)}${t('verified.given', { date: formatDate(v.at.slice(0, 10)), who: v.by ?? '—' })}</p>
            ${v.note ? html`<blockquote class="request-card__message">${v.note}</blockquote>` : ''}
            <form class="portal-decide" data-adopter="${a.id}" data-action="unverify">
              <label class="field">
                <span class="field__label">${t('verified.removeNote')}</span>
                <textarea class="field__input field__input--area" name="note" rows="2" maxlength="500"></textarea>
              </label>
              <div class="portal-decide__actions">
                <button class="button button--outline button--small" type="submit">${t('verified.remove')}</button>
              </div>
            </form>`
        : html`
            <form class="portal-decide" data-adopter="${a.id}" data-action="verify">
              <label class="field">
                <span class="field__label">${t('verified.noteLabel')}</span>
                <textarea class="field__input field__input--area" name="note" rows="2" maxlength="500" placeholder="${t('verified.notePlaceholder')}"></textarea>
              </label>
              <div class="portal-decide__actions">
                <button class="button button--primary button--small" type="submit">${icon(BadgeCheck, 16)}${t('verified.give')}</button>
              </div>
            </form>`}
    </li>`;
}

// ---------- Requests to be a shelter owner (admins) ----------

async function adminOwnersQueue(root: HTMLElement, status: BulkStatus) {
  if (!state.user?.isAdmin) return mount(root, html`<section class="portal"><p class="loading-note">${t('portal.notFound')}</p></section>`);
  mount(root, html`<p class="loading-note" role="status">${t('portal.loading')}</p>`);
  let list: AdminOwnerRequest[];
  let counts: AdminCounts;
  try {
    [list, counts] = await Promise.all([api.adminOwners(status), api.adminSummary()]);
  } catch {
    return mount(root, html`<p class="loading-note" role="alert">${t('auth.err.network')}</p>`);
  }
  mount(
    root,
    html`
      <section class="portal portal--admin" aria-labelledby="portal-title">
        <a class="text-button portal__back" href="/refugio/admin">${t('admin.title')}</a>
        <h1 class="page-title" id="portal-title" tabindex="-1" data-focus>${t('owners.admin.title')}</h1>
        ${adminNav('owners', counts)}
        <p class="portal__lede">${t('owners.admin.lede')}</p>
        <a class="button button--outline button--small portal__new" href="/refugio/admin/registrar">${icon(Plus, 16)}${t('owners.admin.registerLink')}</a>
        <nav class="list-tabs list-tabs--sub" aria-label="${t('owners.admin.title')}">
          ${BULK_QUEUE.map((s) => html`<a class="list-tabs__tab" href="/refugio/admin/duenos?estado=${s}" aria-current="${s === status ? 'page' : 'false'}">${t(`bulk.admin.tab.${s}`)}</a>`)}
        </nav>
        ${list.length ? html`<ul class="portal-list">${list.map(ownerRequestCard)}</ul>` : html`<p class="passed__empty">${t('bulk.admin.empty')}</p>`}
      </section>`,
  );
  $$<HTMLFormElement>('[data-owner-decide]', root).forEach((f) =>
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const action = ((e as SubmitEvent).submitter as HTMLButtonElement | null)?.value as 'approve' | 'decline';
      const note = String(new FormData(f).get('note') ?? '').trim();
      if (action === 'decline' && !note) {
        $<HTMLTextAreaElement>('textarea[name=note]', f).focus();
        return toast(t('bulk.admin.needNote'));
      }
      $$<HTMLButtonElement>('button', f).forEach((b) => (b.disabled = true));
      try {
        await api.adminOwnerDecision(f.dataset.ownerDecide!, action, note || undefined);
        toast(t(`owners.admin.done.${action}`));
        void adminOwnersQueue(root, status);
      } catch (err) {
        $$<HTMLButtonElement>('button', f).forEach((b) => (b.disabled = false));
        toast(failText(err));
      }
    }),
  );
}

function ownerRequestCard(r: AdminOwnerRequest): Raw {
  const row = (label: Key, value: Raw | string | null | undefined) => (value ? html`<div><dt>${t(label)}</dt><dd>${value}</dd></div>` : '');
  const who = r.who.name ?? r.who.email;
  const register = `/refugio/admin/registrar?dueno=${encodeURIComponent(r.who.email)}&nombre=${encodeURIComponent(r.shelterName)}&tel=${encodeURIComponent(r.who.phone)}`;
  return html`
    <li class="portal-card">
      <div class="portal-card__head">
        <span class="shelter__mark" aria-hidden="true">${icon(UserCheck, 22)}</span>
        <div>
          <h2 class="portal-card__name">${t(r.kind === 'private' ? 'owners.admin.wantsPrivate' : 'owners.admin.wants', { who, shelter: r.shelterName })}</h2>
          <span class="portal-card__place">${t('bulk.admin.sent')} ${formatDate(r.createdAt.slice(0, 10))}</span>
        </div>
      </div>
      <p class="bulk-admin__about">${r.about}</p>
      <dl class="portal-facts">
        ${row('owners.admin.contact', html`${emailParts(r.who.email)}<br /><a href="${waLink(r.who.phone)}" target="_blank" rel="noopener">${icon(MessageCircle, 15)} ${showPhone(r.who.phone)}</a>`)}
        ${row('owners.admin.zone', r.zone)}
        ${row('owners.admin.link2', r.link ? html`<a href="${r.link}" target="_blank" rel="noopener noreferrer">${r.link.replace(/^https?:\/\//, '')}</a>` : null)}
      </dl>
      <div class="alikes ${r.lookAlikes.length ? 'alikes--found' : ''}">
        <h3 class="form-subsection__title">${t('owners.admin.alikes')}</h3>
        ${r.lookAlikes.length
          ? html`<ul class="alikes__list">${r.lookAlikes.map(
              (a) => html`<li class="alike alike--${a.why}"><strong>${t(`owners.admin.kind.${a.kind}`)}:</strong> ${a.name} <span class="muted">(${t(`owners.admin.why.${a.why}`)}${a.who ? ` · ${a.who}` : ''} · ${a.kind === 'shelter' ? t(`portal.status.${a.status as 'pending'}`) : t(`owners.admin.req.${a.status as 'pending'}`)})</span></li>`,
            )}</ul>`
          : html`<p class="muted">${t('owners.admin.noAlikes')}</p>`}
      </div>
      ${r.status === 'pending'
        ? html`<form class="portal-decide" data-owner-decide="${r.id}">
            <label class="field">
              <span class="field__label">${t('bulk.admin.noteLabel')}</span>
              <textarea class="field__input field__input--area" name="note" rows="2" maxlength="500" placeholder="${t('bulk.admin.notePlaceholder')}"></textarea>
            </label>
            <div class="portal-decide__actions">
              <button class="button button--primary button--small" type="submit" value="approve">${icon(BadgeCheck, 16)}${t('bulk.admin.approve')}</button>
              <button class="button button--outline button--small" type="submit" value="decline">${t('bulk.admin.decline')}</button>
              ${r.kind === 'private' ? '' : html`<a class="button button--ghost button--small" href="${register}">${t('owners.admin.register')}</a>`}
            </div>
          </form>`
        : r.note
          ? html`<p class="portal-card__reason"><strong>${t('portal.reason')}:</strong> ${r.note}</p>`
          : ''}
    </li>`;
}

// ---------- Special requests to adopt more than three ----------

const BULK_QUEUE: BulkStatus[] = ['pending', 'approved', 'declined'];

async function adminBulkQueue(root: HTMLElement, status: BulkStatus) {
  if (!state.user?.isAdmin) return mount(root, html`<section class="portal"><p class="loading-note">${t('portal.notFound')}</p></section>`);
  mount(root, html`<p class="loading-note" role="status">${t('portal.loading')}</p>`);
  let list: AdminBulk[];
  let counts: AdminCounts;
  try {
    [list, counts] = await Promise.all([api.adminBulk(status), api.adminSummary()]);
  } catch {
    return mount(root, html`<p class="loading-note" role="alert">${t('auth.err.network')}</p>`);
  }
  mount(
    root,
    html`
      <section class="portal portal--admin" aria-labelledby="portal-title">
        <a class="text-button portal__back" href="/refugio/admin">${t('admin.title')}</a>
        <h1 class="page-title" id="portal-title" tabindex="-1" data-focus>${t('bulk.admin.title')}</h1>
        ${adminNav('bulk', counts)}
        <p class="portal__lede">${t('bulk.admin.lede')}</p>
        <nav class="list-tabs list-tabs--sub" aria-label="${t('bulk.admin.title')}">
          ${BULK_QUEUE.map((s) => html`<a class="list-tabs__tab" href="/refugio/admin/grandes?estado=${s}" aria-current="${s === status ? 'page' : 'false'}">${t(`bulk.admin.tab.${s}`)}</a>`)}
        </nav>
        ${list.length ? html`<ul class="portal-list">${list.map(bulkCard)}</ul>` : html`<p class="passed__empty">${t('bulk.admin.empty')}</p>`}
      </section>`,
  );
  $$<HTMLFormElement>('[data-bulk-decide]', root).forEach((f) =>
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const action = ((e as SubmitEvent).submitter as HTMLButtonElement | null)?.value as 'approve' | 'decline';
      const note = String(new FormData(f).get('note') ?? '').trim();
      if (action === 'decline' && !note) {
        const box = $<HTMLTextAreaElement>('textarea[name=note]', f);
        box.focus();
        return toast(t('bulk.admin.needNote'));
      }
      $$<HTMLButtonElement>('button', f).forEach((b) => (b.disabled = true));
      try {
        await api.adminBulkDecision(f.dataset.bulkDecide!, action, note || undefined);
        toast(t(`bulk.admin.done.${action}`));
        void adminBulkQueue(root, status);
      } catch (err) {
        $$<HTMLButtonElement>('button', f).forEach((b) => (b.disabled = false));
        toast(failText(err));
      }
    }),
  );
}

/** An email with a place to wrap after the @, so a long address doesn't break mid-word. */
const emailParts = (email: string): Raw => {
  const at = email.indexOf('@');
  return at < 0 ? html`${email}` : html`${email.slice(0, at)}@<wbr />${email.slice(at + 1)}`;
};

function bulkCard(r: AdminBulk): Raw {
  const row = (label: Key, value: Raw | string | null | undefined) => (value ? html`<div><dt>${t(label)}</dt><dd>${value}</dd></div>` : '');
  const who = r.who.name ?? r.who.email;
  return html`
    <li class="portal-card">
      <div class="portal-card__head">
        <span class="shelter__mark" aria-hidden="true">${icon(UsersRound, 22)}</span>
        <div>
          <h2 class="portal-card__name">${t('bulk.admin.wants', { who, n: r.animals, what: bulkWhat(r.species) })}</h2>
          <span class="portal-card__place">${t('bulk.admin.sent')} ${formatDate(r.createdAt.slice(0, 10))}</span>
        </div>
      </div>
      <p class="bulk-admin__about">${r.about}</p>
      <dl class="portal-facts">
        ${row('bulk.admin.contact', html`${emailParts(r.who.email)}${r.who.phone ? html`<br /><a href="${waLink(r.who.phone)}" target="_blank" rel="noopener">${icon(MessageCircle, 15)} ${showPhone(r.who.phone)}</a>` : ''}`)}
        ${row('bulk.admin.wanted', r.wanted)}
        ${row('bulk.admin.inProgress', r.inProgress.length ? html`${r.inProgress.map((o) => html`${o.pet}${o.shelter ? ` · ${o.shelter}` : ''}<br />`)}` : t('bulk.admin.none'))}
        ${row('bulk.admin.withdrawn', String(r.withdrawn90))}
        ${row('bulk.admin.adopted', String(r.adopted))}
      </dl>
      ${r.status === 'pending'
        ? html`<form class="portal-decide" data-bulk-decide="${r.id}">
            <label class="field">
              <span class="field__label">${t('bulk.admin.noteLabel')}</span>
              <textarea class="field__input field__input--area" name="note" rows="2" maxlength="500" placeholder="${t('bulk.admin.notePlaceholder')}"></textarea>
            </label>
            <div class="portal-decide__actions">
              <button class="button button--primary button--small" type="submit" value="approve">${icon(BadgeCheck, 16)}${t('bulk.admin.approve')}</button>
              <button class="button button--outline button--small" type="submit" value="decline">${t('bulk.admin.decline')}</button>
            </div>
          </form>`
        : r.note
          ? html`<p class="portal-card__reason"><strong>${t('portal.reason')}:</strong> ${r.note}</p>`
          : ''}
    </li>`;
}

function adminCard(s: AdminShelter): Raw {
  const a = s.application;
  const row = (label: Key, value: Raw | string | null | undefined) => (value ? html`<div><dt>${t(label)}</dt><dd>${value}</dd></div>` : '');
  return html`
    <li class="portal-card">
      <div class="portal-card__head">
        <span class="shelter__mark" aria-hidden="true">${icon(House, 22)}</span>
        <div>
          <h2 class="portal-card__name">${s.name}</h2>
          ${where(s.place)}
        </div>
        ${statusChip(s.status)}
      </div>
      ${s.statusReason ? html`<p class="portal-card__reason"><strong>${t('portal.reason')}:</strong> ${s.statusReason}</p>` : ''}
      ${s.review
        ? html`<div class="admin-review">
            <h3 class="form-subsection__title">${t('review.admin.title', { date: formatDate(s.review.createdAt.slice(0, 10)) })}</h3>
            <blockquote class="request-card__message">${s.review.message}</blockquote>
            <p class="muted">${t('review.admin.how')}</p>
          </div>`
        : ''}
      ${s.description ? html`<p>${s.description}</p>` : ''}
      <dl class="portal-facts">
        ${row('portal.admin.owners', s.owners)}
        ${a
          ? html`
              ${row('portal.form.contactName', a.contactName)}
              ${row('portal.form.contactPhone', html`<a href="${waLink(a.contactPhone)}" target="_blank" rel="noopener">${icon(MessageCircle, 15)} ${showPhone(a.contactPhone)}</a>`)}
              ${row('portal.form.address', a.address)}
              ${row('portal.form.rnc', a.rnc)}
              ${row('portal.form.social', a.social.length ? html`${a.social.map((l) => html`<a href="${l}" target="_blank" rel="noopener noreferrer">${l.replace(/^https?:\/\//, '')}</a><br />`)}` : null)}
              ${row('portal.form.reference', html`${a.references.map((r) => html`${r.name} · ${r.contact} (${t(`portal.form.kind.${r.kind}`)})<br />`)}`)}
              ${row('portal.admin.sent', a.submittedAt ? formatDate(a.submittedAt.slice(0, 10)) : null)}`
          : s.kind === 'private'
            ? html`<div><dt>${t('owners.admin.contact')}</dt><dd>${s.publicPhone ? html`<a href="${waLink(s.publicPhone)}" target="_blank" rel="noopener">${icon(MessageCircle, 15)} ${showPhone(s.publicPhone)}</a>` : '—'}</dd></div>`
            : html`<div><dt>${t('portal.admin.noApplication')}</dt><dd>—</dd></div>`}
        ${row('portal.form.visitHours', s.visitHours)}
        ${s.kind === 'private' ? '' : row('portal.form.publicPhone', s.publicPhone ? showPhone(s.publicPhone) : null)}
        ${row('portal.form.email', s.email)}
        ${row('portal.form.website', s.website)}
      </dl>
      ${a?.history ? html`<div class="portal-history"><h3 class="form-subsection__title">${t('portal.form.history')}</h3><p>${a.history}</p></div>` : ''}
      ${(s.status === 'verified' || s.status === 'suspended') && s.kind !== 'private'
        ? html`<form class="fee-cap" data-fee-cap="${s.id}">
            <label class="field">
              <span class="field__label">${t('fee.admin.label')}</span>
              <span class="money"><span class="money__unit" aria-hidden="true">RD$</span><input class="field__input" name="cap" type="number" inputmode="numeric" min="0" max="50000" step="1" value="${s.feeCapDop}" /></span>
              <span class="field__hint">${t(s.feeCapRaised ? 'fee.admin.raised' : 'fee.admin.default')}</span>
            </label>
            <button class="button button--outline button--small" type="submit">${t('fee.admin.save')}</button>
          </form>`
        : ''}
      ${s.kind === 'private' ? html`<p class="muted portal-checklist">${t('lister.admin.note')}</p>` : html`<p class="muted portal-checklist">${t('portal.admin.checklist')}</p>`}
      <form class="portal-decide" data-decide="${s.id}">
        <label class="field" hidden>
          <span class="field__label">${t('portal.admin.reasonLabel')}</span>
          <textarea class="field__input field__input--area" name="reason" rows="2" maxlength="500" placeholder="${t('portal.admin.reasonPlaceholder')}"></textarea>
        </label>
        <div class="portal-decide__actions">
          ${s.status !== 'verified' ? html`<button class="button button--primary button--small" type="submit" value="verify">${icon(BadgeCheck, 16)}${t('portal.admin.verify')}</button>` : ''}
          ${s.status === 'pending' ? html`<button class="button button--outline button--small" type="submit" value="reject">${t('portal.admin.reject')}</button>` : ''}
          ${s.status === 'verified' ? html`<button class="button button--outline button--danger button--small" type="submit" value="suspend">${icon(ShieldOff, 16)}${t('portal.admin.suspend')}</button>` : ''}
          ${s.review ? html`<button class="button button--outline button--small" type="submit" value="keep">${t('review.admin.keep')}</button>` : ''}
        </div>
      </form>
    </li>`;
}

