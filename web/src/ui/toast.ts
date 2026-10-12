import { html, mount } from '../dom';

let region: HTMLElement;
let timer = 0;

export function initToast() {
  region = document.createElement('div');
  region.className = 'toast-region';
  region.setAttribute('role', 'status');
  region.setAttribute('aria-live', 'polite');
  document.body.append(region);
}

export function toast(message: string, action?: { label: string; run: () => void }) {
  clearTimeout(timer);
  mount(region, html`<div class="toast"><span>${message}</span>${action ? html`<button type="button" class="toast__action">${action.label}</button>` : ''}</div>`);
  if (action) {
    region.querySelector('button')!.addEventListener('click', () => {
      action.run();
      region.innerHTML = '';
    });
  }
  timer = window.setTimeout(() => (region.innerHTML = ''), action ? 5200 : 3600);
}
