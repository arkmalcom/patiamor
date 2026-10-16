import { Check, Send } from 'lucide';
import { ApiError, api, type ListerForm } from '../api';
import type { Place } from '../data';
import { $, $$, html, icon, mount, type Raw } from '../dom';
import { failText, t, type Key } from '../i18n';
import { state, update } from '../store';
import { closeSheet, openSheet } from './sheet';

// "Quiero publicar como particular": a person outside any shelter who rehomes animals (a family with a litter).
// They say where they are and who they are; an admin gets to know them and approves the person, not each
// listing. Then they list like a small shelter, and families see "Particular" and the area, never their name.

export function openListerRequest() {
  const user = state.user;
  let place: Place | null = null;
  const body: Raw = html`
    <form class="bulk" id="lister-form" novalidate>
      <p class="bulk__lede">${t('lister.lede')}</p>
      <div class="field">
        <span class="field__label" id="lister-place-label">${t('lister.place')}</span>
        <div class="place-pick">
          <input class="field__input" type="search" autocomplete="off" placeholder="${t('place.searchPlaceholder')}" aria-labelledby="lister-place-label" aria-describedby="lister-place-chosen" data-place-query />
          <ul class="place-pick__results" role="listbox" aria-labelledby="lister-place-label" data-place-results hidden></ul>
          <p class="field__hint" id="lister-place-chosen" data-place-chosen>${t('lister.placeHint')}</p>
        </div>
      </div>
      <label class="field">
        <span class="field__label">${t('lister.phone')}</span>
        <input class="field__input" name="phone" type="tel" inputmode="tel" autocomplete="tel-national" placeholder="809-555-1234" value="${user?.phone ?? ''}" required />
        <span class="field__hint">${t('lister.phoneHint')}</span>
      </label>
      <label class="field">
        <span class="field__label">${t('owner.link')} <span class="muted">(${t('request.optional')})</span></span>
        <input class="field__input" name="link" type="url" maxlength="200" placeholder="https://instagram.com/…" />
      </label>
      <label class="field">
        <span class="field__label">${t('lister.about')}</span>
        <textarea class="field__input field__input--area" name="about" rows="5" maxlength="1000" required></textarea>
        <span class="field__hint">${t('lister.aboutHint')}</span>
      </label>
      <div class="mind">
        <h3 class="mind__title">${t('lister.rulesTitle')}</h3>
        <ul class="mind__list"><li>${t('lister.rule.nofee')}</li><li>${t('lister.rule.limit')}</li><li>${t('lister.rule.contact')}</li></ul>
      </div>
      <label class="consent">
        <input type="checkbox" name="consent" />
        <span>${t('lister.consent')}</span>
      </label>
      <p class="form-error" role="alert" hidden data-error></p>
    </form>`;
  const dialog = openSheet(t('lister.title'), body, {
    footer: html`
      <button class="button button--ghost" type="button" data-cancel>${t('request.cancel')}</button>
      <button class="button button--primary" type="submit" form="lister-form" disabled data-send>${icon(Send, 18)}<span>${t('request.complete')}</span></button>`,
  });
  const form = $<HTMLFormElement>('#lister-form', dialog);
  const send = $<HTMLButtonElement>('[data-send]', dialog);
  const error = $('[data-error]', dialog);

  const read = (): ListerForm => {
    const f = new FormData(form);
    const v = (k: string) => String(f.get(k) ?? '').trim();
    return { placeId: place?.id ?? '', phone: v('phone'), link: v('link'), about: v('about'), consent: f.get('consent') === 'on' };
  };
  const complete = (r: ListerForm) => !!r.placeId && r.phone.replace(/\D/g, '').length >= 10 && r.about.length >= 30 && r.consent;
  const sync = () => {
    const ok = complete(read());
    send.disabled = !ok;
    $('span', send).textContent = t(ok ? 'lister.send' : 'request.complete');
  };

  // The area: a place search like the adopter's; nothing but the chosen place's id leaves the device. Editing
  // the field clears the choice until another is picked, so it never shows an area that isn't selected.
  const query = $<HTMLInputElement>('[data-place-query]', dialog);
  const results = $<HTMLUListElement>('[data-place-results]', dialog);
  const chosen = $('[data-place-chosen]', dialog);
  let timer = 0;
  const showChoice = () => (chosen.textContent = place ? t('lister.placeChosen', { place: `${place.name}, ${place.municipality}` }) : t('lister.placeHint'));
  query.addEventListener('input', () => {
    if (place && query.value !== place.name) ((place = null), showChoice(), sync());
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
          query.value = place.name;
          showChoice();
          results.hidden = true;
          sync();
          query.focus();
        }),
      );
    }, 200);
  });
  query.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !results.hidden) (e.preventDefault(), (results.hidden = true));
  });

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
      const request = await api.sendListerRequest(r);
      update((s) => s.user && (s.user.listerRequest = request)); // the portal behind the sheet redraws with its status
      showDone();
    } catch (err) {
      const code = err instanceof ApiError ? err.code : 'network';
      const known = ['invalid_place', 'invalid_phone', 'invalid_link', 'about_too_short', 'already_pending', 'too_many_requests', 'already_lister'];
      error.textContent = known.includes(code) ? t(`lister.err.${code}` as Key) : failText(err);
      error.hidden = false;
      error.scrollIntoView({ block: 'nearest' });
      sync();
    }
  });
}

function showDone() {
  const body = html`
    <div class="request-done">
      <span class="request-done__mark" aria-hidden="true">${icon(Send, 26)}</span>
      <p class="request-done__lede">${t('lister.doneBody')}</p>
    </div>`;
  const dialog = openSheet(t('owner.doneTitle'), body, {
    footer: html`<button class="button button--primary" type="button" data-done>${icon(Check, 18)}${t('request.done')}</button>`,
  });
  $('[data-done]', dialog).addEventListener('click', () => closeSheet());
}
