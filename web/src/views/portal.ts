import { BadgeCheck, CircleAlert, Clock, House, Mail, MapPin, MessageCircle, Plus, ShieldCheck, ShieldOff, Users } from 'lucide';
import { api, ApiError, type AdminShelter, type PortalShelter, type ShelterApplication, type ShelterForm, type ShelterStatus } from '../api';
import { CONTACT_EMAIL, type Place } from '../data';
import { $, $$, html, icon, mount, type Raw } from '../dom';
import { formatDate, t, type Key } from '../i18n';
import { state } from '../store';
import { renderAuth } from '../ui/auth';
import { toast } from '../ui/toast';

// The shelter portal (#/refugio): register a shelter, follow its verification, and (for admins) work the
// verification queue. Publishing animals arrives with the listing form (PAT-8).

export type PortalView = { view: 'home' } | { view: 'registro' } | { view: 'editar'; id: string } | { view: 'admin'; status: ShelterStatus };

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
        <div class="portal-card"><p>${t('portal.signIn')}</p><div data-auth></div></div>
      </section>`,
  );
  renderAuth($('[data-auth]', root), { next: '#/refugio', onSignedIn: (u) => toast(t('auth.signedIn', { who: u.name ?? u.email })) });
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
        ${state.user?.isAdmin
          ? html`<a class="portal-admin-link" href="#/refugio/admin">${icon(ShieldCheck, 20)}<span>${t('portal.admin.link')}</span>${pending ? html`<span class="list-tabs__count">${pending}</span>` : ''}</a>`
          : ''}
        ${shelters.length
          ? html`<ul class="portal-list">${shelters.map(shelterCard)}</ul>`
          : html`<p class="portal__lede">${t('portal.lede')}</p>${steps()}`}
        ${owned < 3 ? html`<a class="button button--primary portal__new" href="#/refugio/registro">${icon(Plus, 20)}${t('portal.register')}</a>` : ''}
      </section>`,
  );
}

function shelterCard(s: PortalShelter): Raw {
  const next: Record<ShelterStatus, Raw> = {
    pending: html`<p>${t('portal.pendingBody')}</p>`,
    verified: html`<p>${t('portal.verifiedBody')}</p>`,
    rejected: html`
      <p class="portal-card__reason"><strong>${t('portal.reason')}:</strong> ${s.statusReason ?? ''}</p>
      ${s.role === 'owner' ? html`<a class="button button--outline button--small" href="#/refugio/${s.id}/editar">${t('portal.fix')}</a>` : ''}`,
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
    mount(root, html`<section class="portal"><p class="loading-note" role="alert">${t('portal.notFound')}</p><a class="button button--outline" href="#/refugio">${t('portal.back')}</a></section>`);
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
        <a class="text-button portal__back" href="#/refugio">${t('portal.back')}</a>
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
                <input class="field__input" type="search" autocomplete="off" placeholder="${t('place.searchPlaceholder')}" aria-labelledby="place-label" aria-describedby="place-chosen" data-place-query />
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
              ${field('referenceName', 'portal.form.referenceName', { value: a?.reference.name, required: true, max: 80 })}
              ${field('referenceContact', 'portal.form.referenceContact', { value: a?.reference.contact, required: true, max: 120 })}
              <fieldset class="question">
                <legend>${t('portal.form.referenceKind')}</legend>
                <div class="segmented segmented--wrap">
                  ${(['veterinaria', 'refugio', 'otro'] as const).map((k) => html`<label><input type="radio" name="referenceKind" value="${k}" ${a?.reference.kind === k ? 'checked' : ''} /><span>${t(`portal.form.kind.${k}`)}</span></label>`)}
                </div>
              </fieldset>
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

  // The area: a place search like the adopter's, without coordinates leaving the device.
  const query = $<HTMLInputElement>('[data-place-query]', root);
  const results = $<HTMLUListElement>('[data-place-results]', root);
  const chosen = $('[data-place-chosen]', root);
  let timer = 0;
  query.addEventListener('input', () => {
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
          chosen.textContent = t('portal.form.placeChosen', { place: `${place.name}, ${place.municipality}` });
          query.value = '';
          results.hidden = true;
        }),
      );
    }, 200);
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
      reference: { name: v('referenceName'), contact: v('referenceContact'), kind: (f.get('referenceKind') as ShelterForm['reference']['kind']) ?? '' },
      rules: f.get('rules') === 'on',
    };
    send.disabled = true;
    error.hidden = true;
    try {
      if (existing) await api.resubmitShelter(existing.shelter.id, body);
      else await api.registerShelter(body);
      toast(existing ? t('portal.resent') : t('portal.sent'));
      location.hash = '/refugio';
    } catch (err) {
      const code = err instanceof ApiError ? err.code : 'network';
      const known = ['invalid_name', 'invalid_place', 'invalid_contact', 'invalid_phone', 'invalid_public_phone', 'invalid_email', 'invalid_address', 'history_too_short', 'invalid_reference', 'rules_required', 'too_many_shelters', 'not_editable'];
      error.textContent = known.includes(code) ? t(`portal.err.${code as 'invalid_name'}`) : t('auth.err.network');
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
        <a class="text-button portal__back" href="#/refugio">${t('portal.back')}</a>
        <h1 class="page-title" id="portal-title" tabindex="-1" data-focus>${t('portal.admin.title')}</h1>
        <nav class="list-tabs" aria-label="${t('portal.admin.title')}">
          ${QUEUE.map((s) => html`<a class="list-tabs__tab" href="#/refugio/admin?estado=${s}" aria-current="${s === status ? 'page' : 'false'}">${t(`portal.admin.tab.${s}`)}</a>`)}
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
      } catch {
        $$<HTMLButtonElement>('button', f).forEach((b) => (b.disabled = false));
        toast(t('auth.err.network'));
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
              ${row('portal.form.reference', `${a.reference.name} · ${a.reference.contact} (${t(`portal.form.kind.${a.reference.kind}`)})`)}
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

