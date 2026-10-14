import { BadgeCheck, CircleAlert, Clock, House, Mail, MapPin, MessageCircle, Plus, ShieldCheck, ShieldOff, Users } from 'lucide';
import { api, ApiError, type AdminShelter, type PortalShelter, type ReferenceKind, type ShelterApplication, type ShelterForm, type ShelterStatus } from '../api';
import { CONTACT_EMAIL, type Place } from '../data';
import { $, $$, html, icon, mount, type Raw } from '../dom';
import { formatDate, failText, t, type Key } from '../i18n';
import { state } from '../store';
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
  | { view: 'admin'; status: ShelterStatus }
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
  if (route.view === 'registro') return form(root, null);
  if (route.view === 'editar') return void edit(root, route.id);
  if (route.view === 'admin') return void adminQueue(root, route.status);
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
  let pending = 0;
  try {
    shelters = await api.myShelters();
    if (state.user?.isAdmin) pending = (await api.adminShelters('pending')).length;
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
          ? html`<a class="portal-admin-link" href="/refugio/admin">${icon(ShieldCheck, 20)}<span>${t('portal.admin.link')}</span>${pending ? html`<span class="list-tabs__count">${pending}</span>` : ''}</a>`
          : ''}
        ${shelters.length
          ? html`<ul class="portal-list">${shelters.map(shelterCard)}</ul>`
          : html`<p class="portal__lede">${t('portal.lede')}</p>${steps()}`}
        ${owned < 3 ? html`<a class="button ${shelters.length ? 'button--outline' : 'button--primary'} portal__new" href="/refugio/registro">${icon(Plus, 20)}${t('portal.register')}</a>` : ''}
      </section>`,
  );
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

function form(root: HTMLElement, existing: { shelter: PortalShelter; application: ShelterApplication } | null) {
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
        <a class="text-button portal__back" href="/refugio">${t('portal.back')}</a>
        <h1 class="page-title" id="portal-title" tabindex="-1" data-focus>${existing ? t('portal.fixTitle', { name: s!.name }) : t('portal.registerTitle')}</h1>
        ${s?.statusReason ? html`<p class="withdraw-warning"><strong>${t('portal.reason')}:</strong> ${s.statusReason}</p>` : ''}
        <form class="portal-form" id="shelter-form" novalidate>
          <fieldset class="form-section">
            <legend class="section-title">${t('portal.form.public')}</legend>
            <p class="muted">${t('portal.form.publicNote')}</p>
            ${field('name', 'portal.form.name', { value: s?.name, required: true, max: 80, auto: 'organization' })}
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
            ${field('contactPhone', 'portal.form.contactPhone', { value: showPhone(a?.contactPhone), required: true, type: 'tel', inputmode: 'tel', auto: 'tel-national', hint: 'portal.form.contactPhoneHint' })}
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
            <span>${t('portal.form.rules')}</span>
          </label>
          <p class="form-error" role="alert" hidden data-error></p>
          <button class="button button--primary portal-form__send" type="submit" data-send>${existing ? t('portal.form.resend') : t('portal.form.send')}</button>
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
      if (existing) await api.resubmitShelter(existing.shelter.id, body);
      else await api.registerShelter(body);
      toast(existing ? t('portal.resent') : t('portal.sent'));
      navigate('/refugio');
    } catch (err) {
      const code = err instanceof ApiError ? err.code : 'network';
      const known = ['invalid_more_reference', 'invalid_name', 'invalid_place', 'invalid_contact', 'invalid_phone', 'invalid_public_phone', 'invalid_email', 'invalid_address', 'history_too_short', 'invalid_reference', 'rules_required', 'too_many_shelters', 'not_editable', 'too_many_today', 'queue_full'];
      error.textContent = known.includes(code) ? t(`portal.err.${code as 'invalid_name'}`) : failText(code);
      error.hidden = false;
      error.scrollIntoView({ block: 'center', behavior: 'smooth' });
      send.disabled = false;
    }
  });
}

// ---------- Verification queue (admins) ----------

const QUEUE: ShelterStatus[] = ['pending', 'verified', 'rejected', 'suspended'];

async function adminQueue(root: HTMLElement, status: ShelterStatus) {
  if (!state.user?.isAdmin) return mount(root, html`<section class="portal"><p class="loading-note">${t('portal.notFound')}</p></section>`);
  mount(root, html`<p class="loading-note" role="status">${t('portal.loading')}</p>`);
  let shelters: AdminShelter[];
  try {
    shelters = await api.adminShelters(status);
  } catch {
    return mount(root, html`<p class="loading-note" role="alert">${t('auth.err.network')}</p>`);
  }
  mount(
    root,
    html`
      <section class="portal portal--admin" aria-labelledby="portal-title">
        <a class="text-button portal__back" href="/refugio">${t('portal.back')}</a>
        <h1 class="page-title" id="portal-title" tabindex="-1" data-focus>${t('portal.admin.title')}</h1>
        <div class="portal-digest">
          <button class="button button--outline button--small" type="button" data-digest>${t('portal.admin.digest')}</button>
          <p class="muted">${t('portal.admin.digestNote')}</p>
        </div>
        <nav class="list-tabs" aria-label="${t('portal.admin.title')}">
          ${QUEUE.map((s) => html`<a class="list-tabs__tab" href="/refugio/admin?estado=${s}" aria-current="${s === status ? 'page' : 'false'}">${t(`portal.admin.tab.${s}`)}</a>`)}
        </nav>
        ${shelters.length ? html`<ul class="portal-list">${shelters.map(adminCard)}</ul>` : html`<p class="passed__empty">${t('portal.admin.empty')}</p>`}
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

