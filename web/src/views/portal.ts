import { BadgeCheck, CircleAlert, CirclePause, Clock, House, Mail, MapPin, MessageCircle, Plus, ShieldCheck, ShieldOff, UserCheck, Users, UsersRound } from 'lucide';
import { api, ApiError, type AdminBulk, type AdminOwnerRequest, type AdminPaused, type AdminShelter, type BulkStatus, type PortalShelter, type ReferenceKind, type ShelterApplication, type ShelterForm, type ShelterStatus } from '../api';
import { CONTACT_EMAIL, type Place } from '../data';
import { $, $$, html, icon, mount, type Raw } from '../dom';
import { formatDate, failText, t, type Key } from '../i18n';
import { bulkWhat } from '../ui/bulk';
import { setUser, state } from '../store';
import { openOwnerRequest } from '../ui/owner';
import { renderAuth } from '../ui/auth';
import { renderInbox } from './inbox';
import { renderListingForm, renderListings } from './listings';
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
  | { view: 'adminShelters'; status: ShelterStatus }
  | { view: 'adminBulk'; status: BulkStatus }
  | { view: 'adminOwners'; status: BulkStatus }
  | { view: 'adminRegister'; owner: string | null; shelterName: string | null; phone: string | null }
  | { view: 'animales'; id: string; tab: string | null }
  | { view: 'animal'; id: string; petId: string | null }
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
  if (route.view === 'adminShelters') return void adminQueue(root, route.status);
  if (route.view === 'adminBulk') return void adminBulkQueue(root, route.status);
  if (route.view === 'adminOwners') return void adminOwnersQueue(root, route.status);
  if (route.view === 'adminRegister') return state.user?.isAdmin ? form(root, null, { email: route.owner ?? '', name: route.shelterName ?? '', phone: route.phone ?? '' }) : void home(root);
  if (route.view === 'animales') return void renderListings(root, route.id, route.tab);
  if (route.view === 'animal') return void renderListingForm(root, route.id, route.petId);
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
    if (state.user && !state.user.shelterOwner) {
      const me = await api.me();
      if (me && JSON.stringify([me.shelterOwner, me.ownerRequest]) !== JSON.stringify([state.user.shelterOwner, state.user.ownerRequest])) return setUser(me); // redraws
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
      </section>`,
  );
  root.querySelector('[data-owner]')?.addEventListener('click', openOwnerRequest);
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

function shelterCard(s: PortalShelter): Raw {
  const animals = `/refugio/${encodeURIComponent(s.id)}/animales`;
  const next: Record<ShelterStatus, Raw> = {
    pending: html`<p>${t('portal.pendingBody')}</p><a class="button button--outline button--small" href="${animals}">${t('listing.prepare')}</a>`,
    verified: html`
      <p>${t('portal.verifiedBody')}</p>
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
      <a class="button button--ink button--small" href="mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(t('portal.suspendedSubject', { name: s.name }))}">${icon(Mail, 16)}${t('full.manyCta')}</a>`,
  };
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
      ${next[s.status]}
      <p class="portal-card__role">${icon(Users, 15)}${t(`portal.role.${s.role}`)}${s.submittedAt ? html` · ${t('portal.sentOn', { date: formatDate(s.submittedAt.slice(0, 10)) })}` : ''}</p>
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

type AdminCounts = { shelters: number; owners: number; bulk: number; paused: number };
type Queue = keyof AdminCounts;
const QUEUES: Queue[] = ['owners', 'shelters', 'bulk', 'paused'];
const ADMIN_PATH: Record<Queue, string> = { owners: '/refugio/admin/duenos', shelters: '/refugio/admin/refugios', bulk: '/refugio/admin/grandes', paused: '/refugio/admin/pausa' };
const ADMIN_ICON = { owners: UserCheck, shelters: House, bulk: UsersRound, paused: CirclePause } as const;

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
      toast(t('portal.admin.digestDone', { digests: r.digestEmails, alerts: r.alertEmails }) + (r.deferred ? t('portal.admin.digestDeferred') : ''));
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
  let counts: AdminCounts;
  try {
    [shelters, counts] = await Promise.all([api.adminShelters(status), api.adminSummary()]);
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
        ${shelters.length ? html`<ul class="portal-list">${shelters.map(adminCard)}</ul>` : html`<p class="passed__empty">${t('portal.admin.empty')}</p>`}
      </section>`,
  );
  $$<HTMLFormElement>('[data-decide]', root).forEach((f) =>
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const submitter = (e as SubmitEvent).submitter as HTMLButtonElement | null;
      const action = submitter?.value as 'verify' | 'reject' | 'suspend';
      const reason = String(new FormData(f).get('reason') ?? '').trim();
      if (action !== 'verify' && !reason) {
        const box = $<HTMLTextAreaElement>('textarea[name=reason]', f);
        box.closest<HTMLElement>('.field')!.hidden = false;
        box.focus();
        return toast(t('portal.admin.needReason'));
      }
      $$<HTMLButtonElement>('button', f).forEach((b) => (b.disabled = true));
      try {
        await api.adminDecision(f.dataset.decide!, action, reason || undefined);
        toast(t(`portal.admin.done.${action}`));
        void adminQueue(root, status);
      } catch (err) {
        $$<HTMLButtonElement>('button', f).forEach((b) => (b.disabled = false));
        toast(failText(err));
      }
    }),
  );
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
          <h2 class="portal-card__name">${t('owners.admin.wants', { who, shelter: r.shelterName })}</h2>
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
              <a class="button button--ghost button--small" href="${register}">${t('owners.admin.register')}</a>
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
          : html`<div><dt>${t('portal.admin.noApplication')}</dt><dd>—</dd></div>`}
        ${row('portal.form.visitHours', s.visitHours)}
        ${row('portal.form.publicPhone', s.publicPhone ? showPhone(s.publicPhone) : null)}
        ${row('portal.form.email', s.email)}
        ${row('portal.form.website', s.website)}
      </dl>
      ${a?.history ? html`<div class="portal-history"><h3 class="form-subsection__title">${t('portal.form.history')}</h3><p>${a.history}</p></div>` : ''}
      <p class="muted portal-checklist">${t('portal.admin.checklist')}</p>
      <form class="portal-decide" data-decide="${s.id}">
        <label class="field" hidden>
          <span class="field__label">${t('portal.admin.reasonLabel')}</span>
          <textarea class="field__input field__input--area" name="reason" rows="2" maxlength="500" placeholder="${t('portal.admin.reasonPlaceholder')}"></textarea>
        </label>
        <div class="portal-decide__actions">
          ${s.status !== 'verified' ? html`<button class="button button--primary button--small" type="submit" value="verify">${icon(BadgeCheck, 16)}${t('portal.admin.verify')}</button>` : ''}
          ${s.status === 'pending' ? html`<button class="button button--outline button--small" type="submit" value="reject">${t('portal.admin.reject')}</button>` : ''}
          ${s.status === 'verified' ? html`<button class="button button--outline button--danger button--small" type="submit" value="suspend">${icon(ShieldOff, 16)}${t('portal.admin.suspend')}</button>` : ''}
        </div>
      </form>
    </li>`;
}

