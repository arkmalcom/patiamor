import { Check, Send } from 'lucide';
import { ApiError, api, type BulkForm, type BulkRequest, type BulkSpecies } from '../api';
import { $, html, icon, type Raw } from '../dom';
import { failText, t, type Key } from '../i18n';
import { here } from '../nav';
import { loadRequests, state, update } from '../store';
import { renderAuth } from './auth';
import { closeSheet, openSheet } from './sheet';

// "¿Quieres adoptar a más de tres?" (Mi lista, and the sheet that appears when the three slots are full).
// A special request, not about one animal: it explains how it works, then takes the form. An admin reads it
// with the person's other requests in mind; if approved, Patiamor puts them in touch with the shelters.

export const BULK_MIN = 4;
export const BULK_MAX = 30;
const SPECIES: BulkSpecies[] = ['perros', 'gatos', 'ambos'];

/** "perros", "gatos" or "animales", for sentences about a number of them. */
export const bulkWhat = (species: BulkSpecies) => t(`bulk.what.${species}`);

const showPhone = (p: string | null | undefined) => {
  const d = (p ?? '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
  return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` : '';
};

export function openBulk() {
  if (!state.signedIn) return showAuth();
  if (state.user?.requestsRestricted) {
    openSheet(t('request.restrictedTitle'), html`<div class="request-done"><p>${t('request.restrictedBody')}</p></div>`);
    return;
  }
  // One waiting at a time: say so, rather than let them fill a form that will be refused.
  if (state.bulk?.status === 'pending') {
    const dialog = openSheet(t('bulk.waitingTitle'), html`<div class="request-done"><p>${t('bulk.waitingBody', { email: state.user?.email ?? '' })}</p></div>`, {
      footer: html`<button class="button button--primary" type="button" data-done>${icon(Check, 18)}${t('request.done')}</button>`,
    });
    $('[data-done]', dialog).addEventListener('click', () => closeSheet());
    return;
  }
  openForm();
}

function showAuth() {
  const dialog = openSheet(t('bulk.title'), html`<p class="muted auth__intro">${t('bulk.authBody')}</p><div data-auth></div>`);
  renderAuth($('[data-auth]', dialog), {
    next: here(),
    onSignedIn: async () => {
      await loadRequests().catch(() => {});
      openBulk();
    },
  });
}

const steps: Key[] = ['bulk.step1', 'bulk.step2', 'bulk.step3', 'bulk.step4'];

function openForm() {
  const user = state.user;
  const body: Raw = html`
    <form class="bulk" id="bulk-form" novalidate>
      <p class="bulk__lede">${t('bulk.lede')}</p>
      <div class="bulk__how">
        <h3 class="bulk__how-title">${t('bulk.how')}</h3>
        <ol class="bulk__steps">${steps.map((k) => html`<li>${t(k)}</li>`)}</ol>
      </div>
      <label class="field">
        <span class="field__label">${t('bulk.animals')}</span>
        <input class="field__input field__input--short" name="animals" type="number" inputmode="numeric" min="${BULK_MIN}" max="${BULK_MAX}" step="1" required />
        <span class="field__hint">${t('bulk.animalsHint', { min: BULK_MIN, max: BULK_MAX })}</span>
      </label>
      <fieldset class="question">
        <legend>${t('bulk.species')}</legend>
        <div class="segmented segmented--three">
          ${SPECIES.map((s) => html`<label><input type="radio" name="species" value="${s}" /><span>${t(`bulk.species.${s}`)}</span></label>`)}
        </div>
      </fieldset>
      <label class="field">
        <span class="field__label">${t('bulk.wanted')} <span class="muted">(${t('request.optional')})</span></span>
        <input class="field__input" name="wanted" maxlength="200" placeholder="${t('bulk.wantedPlaceholder')}" />
      </label>
      <label class="field">
        <span class="field__label">${t('bulk.about')}</span>
        <textarea class="field__input field__input--area" name="about" rows="5" maxlength="1000" required></textarea>
        <span class="field__hint">${t('bulk.aboutHint')}</span>
      </label>
      <label class="field">
        <span class="field__label">${t('bulk.phone')} <span class="muted">(${t('request.optional')})</span></span>
        <input class="field__input" name="phone" type="tel" inputmode="tel" autocomplete="tel-national" placeholder="809-555-1234" value="${showPhone(user?.phone)}" />
        <span class="field__hint">${t('bulk.phoneHint', { email: user?.email ?? '' })}</span>
      </label>
      <label class="consent">
        <input type="checkbox" name="consent" />
        <span>${t('bulk.consent')}</span>
      </label>
      <p class="form-error" role="alert" hidden data-error></p>
    </form>`;
  const dialog = openSheet(t('bulk.title'), body, {
    footer: html`
      <button class="button button--ghost" type="button" data-cancel>${t('request.cancel')}</button>
      <button class="button button--primary" type="submit" form="bulk-form" disabled data-send>${icon(Send, 18)}<span>${t('request.complete')}</span></button>`,
  });
  const form = $<HTMLFormElement>('#bulk-form', dialog);
  const send = $<HTMLButtonElement>('[data-send]', dialog);
  const error = $('[data-error]', dialog);

  const read = (): BulkForm => {
    const f = new FormData(form);
    return {
      animals: Number(f.get('animals')),
      species: (f.get('species') as BulkSpecies | null) ?? ('' as BulkSpecies),
      wanted: String(f.get('wanted') ?? '').trim(),
      about: String(f.get('about') ?? '').trim(),
      phone: String(f.get('phone') ?? '').trim(),
      consent: f.get('consent') === 'on',
    };
  };
  const complete = (r: BulkForm) =>
    Number.isInteger(r.animals) && r.animals >= BULK_MIN && r.animals <= BULK_MAX && !!r.species && r.about.length >= 30 && (!r.phone || r.phone.replace(/\D/g, '').length >= 10) && r.consent;
  const sync = () => {
    const ok = complete(read());
    send.disabled = !ok;
    $('span', send).textContent = t(ok ? 'bulk.send' : 'request.complete');
  };
  form.addEventListener('input', sync);
  form.addEventListener('change', sync);
  sync();
  $('[data-cancel]', dialog).addEventListener('click', () => closeSheet());

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const r = read();
    if (!complete(r)) return;
    send.disabled = true;
    $('span', send).textContent = t('request.sending');
    error.hidden = true;
    try {
      const bulk = await api.sendBulk(r);
      update((s) => (s.bulk = bulk));
      showDone(bulk);
    } catch (err) {
      const code = err instanceof ApiError ? err.code : 'network';
      const known = ['invalid_animals', 'about_too_short', 'invalid_phone', 'already_pending', 'too_many_bulk', 'restricted'];
      error.textContent = known.includes(code) ? t(`bulk.err.${code}` as Key, { min: BULK_MIN, max: BULK_MAX }) : failText(err);
      error.hidden = false;
      error.scrollIntoView({ block: 'nearest' });
      sync();
    }
  });
}

function showDone(bulk: BulkRequest) {
  const body = html`
    <div class="request-done">
      <span class="request-done__mark" aria-hidden="true">${icon(Send, 26)}</span>
      <p class="request-done__lede">${t('bulk.doneBody', { n: bulk.animals, what: bulkWhat(bulk.species), email: state.user?.email ?? '' })}</p>
    </div>`;
  const dialog = openSheet(t('bulk.doneTitle'), body, {
    footer: html`<button class="button button--primary" type="button" data-done>${icon(Check, 18)}${t('request.done')}</button>`,
  });
  $('[data-done]', dialog).addEventListener('click', () => closeSheet());
}
