import { Check, Send } from 'lucide';
import { ApiError, api, type OwnerForm, type OwnerRequest } from '../api';
import { $, html, icon, type Raw } from '../dom';
import { failText, t, type Key } from '../i18n';
import { state, update } from '../store';
import { closeSheet, openSheet } from './sheet';

// "Solicitar acceso" (the shelter portal): to register a shelter, a person first asks to be a shelter owner.
// This is only who they are and which shelter; an admin gets to know them (and the shelter) and approves,
// and then they can register it. It keeps the review inbox from being open to everyone, and one shelter
// from arriving in a hundred spellings.

export function openOwnerRequest() {
  const user = state.user;
  const body: Raw = html`
    <form class="bulk" id="owner-form" novalidate>
      <p class="bulk__lede">${t('owner.lede')}</p>
      <label class="field">
        <span class="field__label">${t('owner.shelterName')}</span>
        <input class="field__input" name="shelterName" maxlength="80" autocomplete="organization" required />
      </label>
      <label class="field">
        <span class="field__label">${t('owner.zone')}</span>
        <input class="field__input" name="zone" maxlength="80" required />
        <span class="field__hint">${t('owner.zoneHint')}</span>
      </label>
      <label class="field">
        <span class="field__label">${t('owner.phone')}</span>
        <input class="field__input" name="phone" type="tel" inputmode="tel" autocomplete="tel-national" placeholder="809-555-1234" value="${user?.phone ?? ''}" required />
        <span class="field__hint">${t('owner.phoneHint')}</span>
      </label>
      <label class="field">
        <span class="field__label">${t('owner.link')} <span class="muted">(${t('request.optional')})</span></span>
        <input class="field__input" name="link" type="url" maxlength="200" placeholder="https://instagram.com/…" />
      </label>
      <label class="field">
        <span class="field__label">${t('owner.about')}</span>
        <textarea class="field__input field__input--area" name="about" rows="5" maxlength="1000" required></textarea>
        <span class="field__hint">${t('owner.aboutHint')}</span>
      </label>
      <label class="consent">
        <input type="checkbox" name="consent" />
        <span>${t('owner.consent')}</span>
      </label>
      <p class="form-error" role="alert" hidden data-error></p>
    </form>`;
  const dialog = openSheet(t('owner.title'), body, {
    footer: html`
      <button class="button button--ghost" type="button" data-cancel>${t('request.cancel')}</button>
      <button class="button button--primary" type="submit" form="owner-form" disabled data-send>${icon(Send, 18)}<span>${t('request.complete')}</span></button>`,
  });
  const form = $<HTMLFormElement>('#owner-form', dialog);
  const send = $<HTMLButtonElement>('[data-send]', dialog);
  const error = $('[data-error]', dialog);

  const read = (): OwnerForm => {
    const f = new FormData(form);
    const v = (k: string) => String(f.get(k) ?? '').trim();
    return { shelterName: v('shelterName'), zone: v('zone'), phone: v('phone'), link: v('link'), about: v('about'), consent: f.get('consent') === 'on' };
  };
  const complete = (r: OwnerForm) => r.shelterName.length >= 3 && r.zone.length >= 2 && r.phone.replace(/\D/g, '').length >= 10 && r.about.length >= 30 && r.consent;
  const sync = () => {
    const ok = complete(read());
    send.disabled = !ok;
    $('span', send).textContent = t(ok ? 'owner.send' : 'request.complete');
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
      const request = await api.sendOwnerRequest(r);
      update((s) => s.user && (s.user.ownerRequest = request)); // the portal behind the sheet redraws with its status
      showDone(request);
    } catch (err) {
      const code = err instanceof ApiError ? err.code : 'network';
      const known = ['invalid_name', 'invalid_zone', 'invalid_phone', 'invalid_link', 'about_too_short', 'already_pending', 'too_many_requests', 'already_owner'];
      error.textContent = known.includes(code) ? t(`owner.err.${code}` as Key) : failText(err);
      error.hidden = false;
      error.scrollIntoView({ block: 'nearest' });
      sync();
    }
  });
}

function showDone(request: OwnerRequest) {
  const body = html`
    <div class="request-done">
      <span class="request-done__mark" aria-hidden="true">${icon(Send, 26)}</span>
      <p class="request-done__lede">${t('owner.doneBody', { shelter: request.shelterName })}</p>
    </div>`;
  const dialog = openSheet(t('owner.doneTitle'), body, {
    footer: html`<button class="button button--primary" type="button" data-done>${icon(Check, 18)}${t('request.done')}</button>`,
  });
  $('[data-done]', dialog).addEventListener('click', () => closeSheet());
}
