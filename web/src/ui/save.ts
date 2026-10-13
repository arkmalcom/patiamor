import { frameFor } from '../data';
import { html, mount, type Raw } from '../dom';
import { activeRequests, MAX_SLOTS } from '../store';

// Mi lista's three slots, as pips in the nav and tab bar: each filled pip is a request in progress.

/** Re-render helper for any element showing the 3 slot pips. */
export function pips(withCount = false): Raw {
  const slots = activeRequests();
  return html`<span class="pips" aria-hidden="true">${Array.from({ length: MAX_SLOTS }, (_, i) => {
    const s = slots[i];
    return html`<span class="pip" ${s ? html`data-frame="${frameFor(s.pet.id)}"` : ''}></span>`;
  })}${withCount ? html`<span class="pips__count">${slots.length}/${MAX_SLOTS}</span>` : ''}</span>`;
}

export function mountPips(el: Element) {
  mount(el, pips(el.hasAttribute('data-pips-count')));
}
