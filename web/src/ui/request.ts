import { Bell, BellRing, CalendarCheck, Check, Eye, HeartHandshake, House, HouseHeart, Mail, MessageCircle, Send, Undo2, X, type IconNode } from 'lucide';
import { ApiError } from '../api';
import { CONTACT_EMAIL, type PetDetail, type PetSummary } from '../data';
import { $, $$, html, icon, type Raw } from '../dom';
import { formatDate, formatKm, sentence, failText, t } from '../i18n';
import {
  activeRequestFor,
  activeRequests,
  loadRequests,
  FOSTER_LENGTHS,
  MAX_SLOTS,
  petCache,
  placePet,
  sendRequest,
  stashPendingRequest,
  state,
  toggleAlert,
  withdrawRequest,
  type Answers,
  type ContactPref,
  type FosterLength,
  type MyRequest,
  type RequestForm,
  type RequestKind,
  type RequestStatus,
} from '../store';
import { renderAuth } from './auth';
import { openBulk } from './bulk';
import { listerLabel, miniFrame } from './canvas';
import { closeSheet, openSheet } from './sheet';
import { toast } from './toast';
import { here, navigate } from '../nav';
import { legalLinks } from './legal-links';

// Adoption requests. Liking a pet opens its full profile; "Quiero adoptar" in its bar opens this one form: the reflection questions, how to reach the adopter, consent, and
// optionally more for the lister. Each request takes one of Mi lista's 3 slots until it ends or is
// withdrawn; withdrawing is always possible and the lister always sees it. For a shelter's animal the form
// also offers a foster home ("hogar temporal") for a length the person picks, in the same slot.

export const lo = (pet: PetSummary) => (pet.sex === 'hembra' ? 'la' : 'lo');
export const listerName = (pet: PetSummary) => (pet.lister.type === 'shelter' ? pet.lister.name : t('lister.privateWho'));
/** Only shelters take foster homes (a private lister is rehoming their own animal), one at a time. */
export const canFoster = (pet: PetSummary) => pet.lister.type === 'shelter' && !pet.fostered;

/** "+18095551234" or "8095551234" → "809-555-1234". */
const showPhone = (p: string | null | undefined) => {
  const d = (p ?? '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
  return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` : (p ?? '');
};

/** Beyond this the form asks whether they can travel (the same number is in api/src/requests.ts). */
const TRAVEL_FROM_KM = 50;

/** What a careful adopter should know before committing: how far it is, compatibility warnings and the pet's needs. */
export function cautions(pet: PetSummary): string[] {
  const out: string[] = [];
  const km = placePet(pet).km;
  if (km > TRAVEL_FROM_KM) out.push(t('reflect.far', { km: formatKm(km), place: pet.place.name, lo: lo(pet) }));
  if (pet.goodWith.cats === false) out.push(t('reflect.notCats'));
  if (pet.goodWith.dogs === false) out.push(t('reflect.notDogs'));
  if (pet.goodWith.kids === false) out.push(t('reflect.notKids'));
  return [...out, ...((pet as PetDetail).needs ?? [])];
}

/** "Ten en cuenta" and the adoption fee: shown at the end of the profile and again at the top of the
 *  form, so everyone sees them however they got there. Empty when there's nothing to say. */
export function beforeYouStart(pet: PetSummary): Raw {
  const notes = cautions(pet);
  const fee = (pet as PetDetail).adoptionFeeDop ?? null;
  if (!notes.length && fee === null) return html``;
  return html`
    ${notes.length ? html`<div class="mind"><h3 class="mind__title">${t('reflect.mind')}</h3><ul class="mind__list">${notes.map((n) => html`<li>${n}</li>`)}</ul></div>` : ''}
    ${fee !== null ? html`<p class="ready__fee">${t('profile.ready.fee', { fee: `RD$${fee.toLocaleString('es-DO')}` })}</p>` : ''}`;
}

function choice(name: string, legend: string, values: string[], label: (v: string) => string, opts: { type?: 'radio' | 'checkbox'; hint?: string; stack?: boolean } = {}): Raw {
  return html`
    <fieldset class="question">
      <legend>${legend}</legend>
      ${opts.hint ? html`<p class="question__hint">${opts.hint}</p>` : ''}
      <div class="segmented ${opts.stack ? 'segmented--stack' : 'segmented--wrap'}">
        ${values.map((v) => html`<label><input type="${opts.type ?? 'radio'}" name="${name}" value="${v}" /><span>${label(v)}</span></label>`)}
      </div>
    </fieldset>`;
}

/** Dogs need walks; cats need play and company. */
function timeQuestion(pet: PetSummary): string {
  const cat = pet.species === 'gato';
  if (pet.energy === 'alta') return cat ? t('reflect.q.time.high.cat', { name: pet.name }) : t('reflect.q.time.high', { name: pet.name, lo: lo(pet) });
  return cat ? t('reflect.q.time.cat', { lo: lo(pet) }) : t('reflect.q.time', { lo: lo(pet) });
}

const yesUnsure = (v: string) => (v === 'si' ? t('reflect.yes') : t('reflect.unsure'));
const costQuestion = (kind: RequestKind) => t(kind === 'foster' ? 'reflect.q.cost.foster' : 'reflect.q.cost');
const reflection = (pet: PetSummary, kind: RequestKind) => [
  choice('space', pet.size === 'grande' && pet.species === 'perro' ? t('reflect.q.space.big', { name: pet.name }) : t('reflect.q.space', { un: t(`animal.${pet.species}.un`) }), ['si', 'pensando'], yesUnsure),
  choice('time', timeQuestion(pet), ['si', 'pensando'], yesUnsure),
  choice('cost', costQuestion(kind), ['si', 'pensando'], yesUnsure),
];

/** Starts the process for a pet: signs in first if needed, makes room if Mi lista is full, then the form.
 *  `kind` picks what the form opens on; the person can still switch there. */
export function startRequest(petId: string, kind: RequestKind = 'adopt') {
  const pet = petCache.get(petId);
  if (!pet || activeRequestFor(petId)) return;
  if (!state.signedIn) return showAuth(pet);
  if (state.user?.requestsRestricted) return void openRestricted();
  if (activeRequests().length >= MAX_SLOTS) return openFull(pet);
  openForm(pet, kind === 'foster' && canFoster(pet) ? 'foster' : 'adopt');
}

/** Reopens a request interrupted by a sign-in redirect (Google, the email link). */
export async function resumePendingRequest(petId: string | null) {
  if (!petId || !state.signedIn) return;
  await loadRequests().catch(() => {});
  navigate(`/mascota/${encodeURIComponent(petId)}`);
  startRequest(petId);
}

function showAuth(pet: PetSummary) {
  const dialog = openSheet(t('auth.title', { name: pet.name }), html`<p class="muted auth__intro">${t('auth.body')}</p><div data-auth></div>`);
  renderAuth($('[data-auth]', dialog), {
    next: here(),
    beforeRedirect: () => stashPendingRequest(pet.id),
    onSignedIn: async () => {
      await loadRequests().catch(() => {});
      startRequest(pet.id);
    },
  });
}

/** Three requests in progress: no swapping on the spot. Another can start when one of them ends. */
function openFull(pet: PetSummary) {
  const body = html`
    <div class="full">
      <p class="muted">${t('full.body', { name: pet.name })}</p>
      <ul class="full__slots">
        ${activeRequests().map(
          ({ pet: d }) => html`<li class="full__slot">
            ${miniFrame(d, 'sm')}
            <span class="full__slot-text"><strong>${d.name}</strong><span class="muted">${listerLabel(d)}</span></span>
          </li>`,
        )}
      </ul>
      <a class="text-button" href="/lista" data-to-list>${t('full.toList')}</a>
      <div class="many">
        <h3 class="many__title">${t('full.manyTitle')}</h3>
        <p>${t('full.manyBody')}</p>
        <button class="button button--ink" type="button" data-bulk>${t('bulk.promptCta')}</button>
      </div>
    </div>`;
  const dialog = openSheet(t('full.title'), body);
  $('[data-to-list]', dialog).addEventListener('click', () => closeSheet());
  $('[data-bulk]', dialog).addEventListener('click', openBulk);
}

/** New requests are paused after several withdrawals, until Patiamor has checked in. */
function openRestricted() {
  const body = html`<div class="request-done"><p>${t('request.restrictedBody')}</p></div>`;
  const dialog = openSheet(t('request.restrictedTitle'), body, {
    footer: html`<a class="button button--ink" href="mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(t('request.restrictedSubject'))}">${icon(Mail, 18)}${t('full.manyCta')}</a>`,
  });
  return dialog;
}

const PREFS: ContactPref[] = ['whatsapp', 'llamada', 'correo'];

function openForm(pet: PetSummary, initial: RequestKind) {
  const lister = listerName(pet);
  const fosterable = canFoster(pet);
  const user = state.user;
  // A returning adopter sees one line with how they'll be reached, and can change it.
  const known = !!(user?.name && user.contactPref && (user.contactPref === 'correo' || user.phone));
  const far = placePet(pet).km > TRAVEL_FROM_KM;
  const pref = user?.contactPref ?? 'whatsapp';
  const body = html`
    <form class="request" id="request-form" novalidate>
      <div class="request__intro">
        ${miniFrame(pet)}
        <div>
          <p class="muted">${t('request.intro', { lister })}</p>
          <p class="request__slot">${t('request.slot', { n: activeRequests().length + 1 })}</p>
          ${pet.requests === 'busy' ? html`<p class="request__busy">${t('request.busy', { lister })}</p>` : ''}
        </div>
      </div>
      ${fosterable
        ? html`<fieldset class="question">
              <legend>${t('request.kind', { name: pet.name })}</legend>
              <div class="segmented segmented--wrap">
                ${(['adopt', 'foster'] as const).map((k) => html`<label><input type="radio" name="kind" value="${k}" ${k === initial ? 'checked' : ''} /><span>${t(`request.kind.${k}`, { lo: lo(pet) })}</span></label>`)}
              </div>
              <p class="question__hint" data-foster-only>${t('request.kindHint', { lo: lo(pet), lister })}</p>
            </fieldset>
            <div data-foster-only>
              ${choice('fosterLength', t('request.fosterLength', { lo: lo(pet) }), [...FOSTER_LENGTHS], (v) => t(`request.fosterLength.${v as FosterLength}`), { hint: t('request.fosterLengthHint') })}
            </div>`
        : ''}
      ${beforeYouStart(pet)}
      ${reflection(pet, initial)}
      ${far ? choice('travel', t('request.travel', { name: pet.name }), ['si', 'pensando'], yesUnsure, { hint: t('request.travelHint', { km: formatKm(placePet(pet).km), place: pet.place.name }) }) : ''}
      <p class="unsure-note" hidden data-unsure>${t('reflect.unsureNote', { lister })}</p>
      <fieldset class="question contact">
        <legend>${t('request.contact')}</legend>
        ${known
          ? html`<div class="contact__known" data-known>
              <p>${t('request.contactKnown', { how: t(`request.pref.${pref}`), who: user!.name ?? '', where: pref === 'correo' ? user!.email : showPhone(user!.phone) })}</p>
              <button class="text-button" type="button" data-edit-contact>${t('request.change')}</button>
            </div>`
          : ''}
        <div class="contact__fields" ${known ? 'hidden' : ''} data-fields>
          <label class="field">
            <span class="field__label">${t('request.name')}</span>
            <input class="field__input" name="name" autocomplete="name" minlength="2" maxlength="80" value="${user?.name ?? ''}" />
          </label>
          <div class="field">
            <span class="field__label" id="pref-label">${t('request.prefLabel')}</span>
            <div class="segmented segmented--wrap" role="radiogroup" aria-labelledby="pref-label">
              ${PREFS.map((p) => html`<label><input type="radio" name="pref" value="${p}" ${pref === p ? 'checked' : ''} /><span>${t(`request.pref.${p}`)}</span></label>`)}
            </div>
          </div>
          <label class="field">
            <span class="field__label">${t('request.phone')} <span class="muted" data-phone-optional hidden>(${t('request.optional')})</span></span>
            <input class="field__input" name="phone" type="tel" inputmode="tel" autocomplete="tel-national" placeholder="809-555-1234" value="${showPhone(user?.phone)}" aria-describedby="phone-hint" />
            <span class="field__hint" id="phone-hint">${t('request.phoneHint')}</span>
          </label>
        </div>
      </fieldset>
      <details class="more">
        <summary><span>${t('request.more', { lister })} <span class="muted">(${t('request.optional')})</span></span></summary>
        ${choice('home', t('request.home', { name: pet.name }), ['casa_patio', 'casa', 'apartamento'], (v) => t(`request.home.${v as 'casa'}`))}
        ${choice('otherPets', t('request.otherPets'), ['perros', 'gatos', 'otros'], (v) => t(`request.otherPets.${v as 'perros'}`), { type: 'checkbox', hint: t('request.otherPetsHint') })}
        ${choice('kids', t('request.kids'), ['no', 'menores', 'mayores'], (v) => t(`request.kids.${v as 'no'}`))}
        ${choice('experience', t('request.experience'), ['si', 'primera'], (v) => t(`request.experience.${v as 'si'}`))}
        ${choice('visit', t('request.visit', { lo: lo(pet) }), ['semana', 'fin', 'cualquiera'], (v) => t(`request.visit.${v as 'fin'}`))}
        <label class="field">
          <span class="field__label">${t('request.message', { lister })}</span>
          <textarea class="field__input field__input--area" name="message" rows="3" maxlength="500"></textarea>
        </label>
      </details>
      <p class="request__warning" data-warning>${t(initial === 'foster' ? 'request.warning.foster' : 'request.warning', { name: pet.name, lister })}</p>
      <label class="consent">
        <input type="checkbox" name="consent" />
        <span>${t('request.consent', { email: user?.email ?? '', lister })}</span>
      </label>
      ${legalLinks('legal.send', true)}
      <p class="form-error" role="alert" hidden data-error></p>
    </form>`;
  const footer = html`
    <button class="button button--ghost" type="button" data-cancel>${t('request.cancel')}</button>
    <button class="button button--primary" type="submit" form="request-form" disabled data-send>${icon(Send, 18)}<span>${t('request.complete')}</span></button>`;

  const title = (kind: RequestKind) => t(kind === 'foster' ? 'request.title.foster' : 'request.title', { name: pet.name });
  const dialog = openSheet(title(initial), body, { footer });
  const form = $<HTMLFormElement>('#request-form', dialog);
  const send = $<HTMLButtonElement>('[data-send]', dialog);
  const error = $('[data-error]', dialog);
  const showFields = () => {
    dialog.querySelector<HTMLElement>('[data-known]')?.setAttribute('hidden', '');
    $('[data-fields]', dialog).hidden = false;
  };

  const read = (): RequestForm => {
    const f = new FormData(form);
    const opt = <T,>(k: string) => (f.get(k) as T | null) ?? undefined;
    const kind: RequestKind = f.get('kind') === 'foster' ? 'foster' : 'adopt';
    return {
      petId: pet.id,
      kind,
      fosterLength: kind === 'foster' ? opt<FosterLength>('fosterLength') : undefined,
      answers: { space: f.get('space'), time: f.get('time'), cost: f.get('cost') } as Answers,
      name: String(f.get('name') ?? '').trim(),
      phone: String(f.get('phone') ?? '').trim(),
      pref: (f.get('pref') as ContactPref | null) ?? 'whatsapp',
      home: opt('home'),
      otherPets: f.getAll('otherPets') as RequestForm['otherPets'],
      kids: opt('kids'),
      experience: opt('experience'),
      visit: opt('visit'),
      message: String(f.get('message') ?? '').trim(),
      consent: f.get('consent') === 'on',
      travel: far ? ((f.get('travel') as RequestForm['travel'] | null) ?? undefined) : undefined,
      fromPlaceId: state.location?.id,
    };
  };
  const phoneOk = (r: RequestForm) => (r.pref === 'correo' && !r.phone) || r.phone.replace(/\D/g, '').length >= 10;
  const complete = (r: RequestForm) =>
    !!(r.answers.space && r.answers.time && r.answers.cost) && (r.kind !== 'foster' || !!r.fosterLength) && (!far || !!r.travel) && r.name.length >= 2 && phoneOk(r) && r.consent;
  /** Adopting and fostering share the form; what differs follows the choice (a foster pays no adoption fee). */
  let shownKind: RequestKind | null = null;
  const showKind = (kind: RequestKind) => {
    if (kind === shownKind) return;
    shownKind = kind;
    $$<HTMLElement>('[data-foster-only]', dialog).forEach((el) => (el.hidden = kind !== 'foster'));
    dialog.querySelector<HTMLElement>('.ready__fee')?.toggleAttribute('hidden', kind === 'foster');
    $('#sheet-title', dialog).textContent = title(kind);
    $('input[name=cost]', dialog).closest('fieldset')!.querySelector('legend')!.textContent = costQuestion(kind);
    $('[data-warning]', dialog).textContent = t(kind === 'foster' ? 'request.warning.foster' : 'request.warning', { name: pet.name, lister });
  };
  const sync = () => {
    const r = read();
    showKind(r.kind);
    const ok = complete(r);
    send.disabled = !ok;
    $('span', send).textContent = ok ? t('request.send') : t('request.complete');
    $('[data-unsure]', dialog).hidden = !Object.values(r.answers).includes('pensando');
    $('[data-phone-optional]', dialog).hidden = r.pref !== 'correo';
  };
  form.addEventListener('input', sync);
  form.addEventListener('change', sync);
  sync();
  dialog.querySelector('[data-edit-contact]')?.addEventListener('click', () => {
    showFields();
    $<HTMLInputElement>('input[name=name]', dialog).focus();
  });
  $('[data-cancel]', dialog).addEventListener('click', () => closeSheet());

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const r = read();
    if (!complete(r)) return;
    send.disabled = true;
    $('span', send).textContent = t('request.sending');
    error.hidden = true;
    try {
      await sendRequest(r);
      showDone(pet, r.kind);
    } catch (err) {
      const code = err instanceof ApiError ? err.code : 'network';
      if (code === 'requests_full') return openFull(pet);
      if (code === 'restricted') return void openRestricted();
      if (code === 'invalid_phone' || code === 'invalid_name') showFields(); // so it can be fixed
      const known = ['invalid_phone', 'invalid_name', 'reserved', 'paused', 'travel_required', 'fostered'];
      error.textContent = known.includes(code) ? sentence(t(`request.err.${code as 'invalid_phone'}`, { name: pet.name, lister, lo: lo(pet) })) : failText(code);
      error.hidden = false;
      error.scrollIntoView({ block: 'nearest' });
      sync();
    }
  });
}

function showDone(pet: PetSummary, kind: RequestKind) {
  const lister = listerName(pet);
  const body = html`
    <div class="request-done">
      <span class="request-done__mark" aria-hidden="true">${icon(Send, 26)}</span>
      <p class="request-done__lede">${sentence(t(kind === 'foster' ? 'request.doneBody.foster' : 'request.doneBody', { lister, name: pet.name }))}</p>
      <ol class="request-done__steps">
        <li>${t('request.next1')}</li>
        <li>${t('request.next2')}</li>
        <li>${t('request.next3')}</li>
      </ol>
    </div>`;
  const dialog = openSheet(t('request.doneTitle'), body, {
    footer: html`<button class="button button--primary" type="button" data-done>${icon(Check, 18)}${t('request.done')}</button>`,
  });
  $('[data-done]', dialog).addEventListener('click', () => closeSheet());
}

/** Withdrawing is a serious step: a plain warning, a required reason, and the lister always sees it. */
export function openWithdraw(item: MyRequest) {
  const { pet, request } = item;
  const lister = listerName(pet);
  const body = html`
    <form class="request" id="withdraw-form">
      <div class="withdraw-warning">
        <p>${t('request.withdrawWarning', { animal: t(`animal.${pet.species}.one`) })}</p>
        <p>${t('request.withdrawLimit')}</p>
      </div>
      <p>${sentence(t('request.withdrawBody', { lister }))}</p>
      ${choice('reason', t('request.withdrawWhy'), ['situacion', 'vivienda', 'otra_mascota', 'refugio', 'otro'], (v) => t(`request.withdraw.${v as 'situacion'}`), { stack: true })}
    </form>`;
  const footer = html`
    <button class="button button--primary" type="button" data-keep>${t('request.keep')}</button>
    <button class="button button--outline button--danger" type="submit" form="withdraw-form" disabled data-go>${icon(X, 18)}${t('request.withdraw')}</button>`;
  const dialog = openSheet(t('request.withdrawTitle', { name: pet.name }), body, { footer });
  const form = $<HTMLFormElement>('#withdraw-form', dialog);
  const go = $<HTMLButtonElement>('[data-go]', dialog);
  const reason = () => new FormData(form).get('reason') as string | null;
  form.addEventListener('change', () => (go.disabled = !reason()));
  $('[data-keep]', dialog).addEventListener('click', () => closeSheet());
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const why = reason();
    if (!why) return;
    go.disabled = true;
    try {
      await withdrawRequest(request.id, why);
      toast(t('request.withdrawn', { name: pet.name }));
      closeSheet();
    } catch (err) {
      go.disabled = false;
      toast(failText(err));
    }
  });
}

const STATUS_ICON: Record<RequestStatus, IconNode> = {
  sent: Send,
  seen: Eye,
  contacted: MessageCircle,
  visit: CalendarCheck,
  fostering: HouseHeart,
  adopted: House,
  closed: HeartHandshake,
  withdrawn: Undo2,
};

/** "closed" because the pet went home with another family, or was withdrawn, reads differently from a lister's no;
 *  a foster that ended, or a foster offer the shelter didn't need, has its own words. */
export const statusKey = (item: MyRequest) => {
  const { request, pet } = item;
  if (request.status !== 'closed') return request.status;
  if (pet.status === 'adopted') return 'found';
  if (pet.status === 'withdrawn') return 'gone';
  if (request.kind === 'foster') return request.fosterStartedAt ? 'fosterEnded' : 'fosterClosed';
  return 'closed';
};

/** "Hogar temporal · 1 mes" for a foster offer; nothing for an adoption. */
export const kindTag = (request: MyRequest['request']) =>
  request.kind === 'foster' && request.fosterLength ? t('request.kindTag.foster', { length: t(`request.fosterLength.${request.fosterLength}`) }) : '';

/** Where a request stands, in the adopter's words. */
export function requestStatus(item: MyRequest): Raw {
  const { pet, request } = item;
  const lister = listerName(pet);
  const key = statusKey(item);
  return html`
    <div class="req-status req-status--${request.status}" role="status">
      <span class="req-status__mark" aria-hidden="true">${icon(STATUS_ICON[request.status], 18)}</span>
      <div>
        <p class="req-status__title">${sentence(t(`request.status.${key as 'sent'}`, { lister, name: pet.name, lo: lo(pet) }))}</p>
        <p class="req-status__body">${sentence(t(`request.status.${key as 'sent'}.body`, { lister, name: pet.name, lo: lo(pet) }))}</p>
        <p class="req-status__date">${t('request.sentOn', { date: formatDate(request.createdAt.slice(0, 10)) })}</p>
      </div>
    </div>`;
}

/** The "Avísame" toggle for a pet en proceso or paused. */
export function alertButton(pet: PetSummary, small = false): Raw {
  const on = state.alerts.includes(pet.id);
  return html`<button class="button button--outline ${small ? 'button--small' : ''} alert-toggle" type="button" data-alert="${pet.id}" aria-pressed="${String(on)}">
    ${icon(on ? BellRing : Bell, 18)}<span>${on ? t('alert.set') : t('alert.on')}</span></button>`;
}

export function bindAlerts(root: ParentNode) {
  $$<HTMLButtonElement>('[data-alert]', root).forEach((b) =>
    b.addEventListener('click', async () => {
      const id = b.dataset.alert!;
      const name = petCache.get(id)?.name ?? '';
      const wasOn = state.alerts.includes(id);
      b.disabled = true;
      try {
        await toggleAlert(id);
        toast(wasOn ? t('alert.toastOff', { name }) : t('alert.toastOn', { name }));
      } catch (err) {
        b.disabled = false;
        toast((err as { code?: string }).code === 'too_many_alerts' ? t('alert.err.too_many') : failText(err));
      }
    }),
  );
}
