import { api } from '../api';
import type { Place } from '../data';
import { $, $$, html, mount, type Raw } from '../dom';
import { t } from '../i18n';

// A place search for a form field (where a lost animal was last seen): only the chosen place's id leaves the
// device. Editing the text afterwards clears the choice until another is picked, so the field never shows a
// place that isn't selected. The shelter registration and private lister forms have their own copies.

export const placePick = (label: string, hint: string, place: Place | null): Raw => html`
  <div class="field">
    <span class="field__label" id="pick-place-label">${label}</span>
    <div class="place-pick">
      <input class="field__input" type="search" autocomplete="off" placeholder="${t('place.searchPlaceholder')}" aria-labelledby="pick-place-label" aria-describedby="pick-place-chosen" value="${place?.name ?? ''}" data-place-query />
      <ul class="place-pick__results" role="listbox" aria-labelledby="pick-place-label" data-place-results hidden></ul>
      <p class="field__hint" id="pick-place-chosen" data-place-chosen>${hint}</p>
    </div>
  </div>`;

/** Binds the field drawn by placePick() inside `scope`; `describe` words the hint for the current choice. */
export function bindPlacePick(scope: HTMLElement, initial: Place | null, describe: (p: Place | null) => string) {
  let place = initial;
  const query = $<HTMLInputElement>('[data-place-query]', scope);
  const results = $<HTMLUListElement>('[data-place-results]', scope);
  const chosen = $('[data-place-chosen]', scope);
  const show = () => (chosen.textContent = describe(place));
  show();
  let timer = 0;
  query.addEventListener('input', () => {
    if (place && query.value !== place.name) ((place = null), show());
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
          show();
          results.hidden = true;
          query.focus();
        }),
      );
    }, 200);
  });
  query.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !results.hidden) (e.preventDefault(), (results.hidden = true));
  });
  return { get place() { return place; } };
}
