import { X } from 'lucide';
import { $, html, icon, mount, reducedMotion, type Raw } from '../dom';
import { t } from '../i18n';

// One reusable bottom sheet (centered panel on desktop) built on a modal <dialog>.

let dialog: HTMLDialogElement;
let onClose: (() => void) | null = null;

export function initSheet() {
  dialog = document.createElement('dialog');
  dialog.className = 'sheet';
  dialog.setAttribute('closedby', 'any');
  dialog.setAttribute('aria-labelledby', 'sheet-title');
  document.body.append(dialog);

  // Light-dismiss fallback for browsers without `closedby`.
  if (!('closedBy' in HTMLDialogElement.prototype)) {
    dialog.addEventListener('click', (e) => {
      if (e.target !== dialog) return;
      const r = dialog.getBoundingClientRect();
      const inside = r.top <= e.clientY && e.clientY <= r.bottom && r.left <= e.clientX && e.clientX <= r.right;
      if (!inside) closeSheet();
    });
  }
  dialog.addEventListener('close', () => {
    document.documentElement.classList.remove('sheet-open');
    const fn = onClose;
    onClose = null;
    fn?.();
  });
}

export function openSheet(title: string, body: Raw, opts: { wide?: boolean; onClose?: () => void; footer?: Raw } = {}) {
  onClose = opts.onClose ?? null;
  dialog.classList.toggle('sheet--wide', !!opts.wide);
  mount(
    dialog,
    html`
      <div class="sheet__grabber" aria-hidden="true"></div>
      <header class="sheet__head">
        <h2 class="sheet__title" id="sheet-title">${title}</h2>
        <button class="icon-button" type="button" data-close aria-label="${t('sheet.close')}">${icon(X, 22)}</button>
      </header>
      <div class="sheet__body">${body}</div>
      ${opts.footer ? html`<footer class="sheet__foot">${opts.footer}</footer>` : ''}
    `,
  );
  dialog.querySelector('[data-close]')!.addEventListener('click', () => closeSheet());
  if (!dialog.open) {
    dialog.showModal();
    document.documentElement.classList.add('sheet-open');
    if (!reducedMotion()) {
      dialog.animate([{ transform: `translateY(${sheetFrom()})`, opacity: 0.4 }, { transform: 'none', opacity: 1 }], { duration: 380, easing: 'cubic-bezier(.16,1,.3,1)' });
    }
  }
  dialog.scrollTop = 0;
  $('.sheet__body', dialog).scrollTop = 0;
  return dialog;
}

export function closeSheet() {
  if (!dialog.open) return;
  if (reducedMotion()) return dialog.close();
  dialog
    .animate([{ transform: 'none', opacity: 1 }, { transform: `translateY(${sheetFrom()})`, opacity: 0 }], { duration: 220, easing: 'cubic-bezier(.4,0,1,1)' })
    .finished.then(() => dialog.close());
}

export const sheetEl = () => dialog;

const sheetFrom = () => getComputedStyle(dialog).getPropertyValue('--sheet-from').trim() || '100%';
