import { Camera, Star, X } from 'lucide';
import type { ListingPhoto } from '../api';
import { $, html, icon, mount, type Raw } from '../dom';
import { t } from '../i18n';
import { PhotoError, preparePhoto, toBase64, type PreparedPhoto } from './photos';

// Photos in a form (a listing's, PAT-9, or a help case's): up to five, the first is the cover, and a tap on
// the face sets the framing. New photos are resized on this phone and only sent when the form is saved,
// with removals, order and framing, so a half-finished form uploads nothing.

const MAX_PHOTOS = 5;

/** A photo in the form: already on the server (`id`), or prepared on this phone and sent on save. */
export type EditorPhoto = { id?: string; url: string; thumb: string | null; focus: string; prepared?: PreparedPhoto };

/** Where the photos go: the listing's or the case's endpoints. */
export interface PhotoTarget {
  upload: (body: { image: string; thumb: string; focus: string }) => Promise<ListingPhoto>;
  arrange: (photos: { id: string; focus: string }[]) => Promise<unknown>;
  remove: (photoId: string) => Promise<unknown>;
}

export const photoEditor = (): Raw => html`
  <ul class="photo-grid" data-photos></ul>
  <label class="button button--outline photo-add" data-photo-add>
    ${icon(Camera, 20)}<span>${t('listing.addPhotos')}</span>
    <input class="sr-only" type="file" accept="image/*" multiple data-photo-input />
  </label>
  <p class="field__hint" role="status" data-photo-status></p>
  <div class="photo-focus" data-focus-panel hidden>
    <p class="field__label">${t('listing.focus')}</p>
    <p class="field__hint" id="focus-hint">${t('listing.focusHint')}</p>
    <button class="photo-focus__frame" type="button" aria-describedby="focus-hint" data-focus-frame></button>
  </div>`;

/** Binds the editor drawn by photoEditor() inside `scope`. `onChange` runs whenever the photos change (a preview
 *  redraws), `onAdd` when one is added (an error asking for a photo no longer applies). */
export function bindPhotoEditor(scope: HTMLElement, initial: ListingPhoto[], { onChange = () => {}, onAdd = () => {} }: { onChange?: () => void; onAdd?: () => void } = {}) {
  const items: EditorPhoto[] = initial.map((p) => ({ id: p.id, url: p.url, thumb: p.thumb, focus: p.focus }));
  const removed: string[] = [];
  let arranged = false; // order or framing changed for photos already on the server
  let selected = 0;
  const grid = $('[data-photos]', scope);
  const addLabel = $<HTMLLabelElement>('[data-photo-add]', scope);
  const fileInput = $<HTMLInputElement>('[data-photo-input]', scope);
  const photoStatus = $('[data-photo-status]', scope);
  const focusPanel = $('[data-focus-panel]', scope);
  const focusFrame = $<HTMLButtonElement>('[data-focus-frame]', scope);

  const draw = (notify = true) => {
    selected = Math.min(selected, Math.max(0, items.length - 1));
    mount(
      grid,
      html`${items.map(
        (it, i) => html`
          <li class="photo-tile${i === selected ? ' is-selected' : ''}">
            <button class="photo-tile__pick" type="button" data-pick="${i}" aria-pressed="${String(i === selected)}" aria-label="${t('listing.photoN', { n: i + 1 })}">
              <img src="${it.thumb ?? it.url}" alt="" style="object-position:${it.focus}" draggable="false" />
            </button>
            ${i === 0
              ? html`<span class="photo-tile__badge">${icon(Star, 14)}${t('listing.cover')}</span>`
              : html`<button class="photo-tile__action" type="button" data-cover="${i}">${icon(Star, 14)}${t('listing.makeCover')}</button>`}
            <button class="photo-tile__remove" type="button" data-remove="${i}" aria-label="${t('listing.removePhoto', { n: i + 1 })}">${icon(X, 16)}</button>
          </li>`,
      )}`,
    );
    addLabel.hidden = items.length >= MAX_PHOTOS;
    focusPanel.hidden = !items.length;
    const it = items[selected];
    if (it) {
      const [x, y] = it.focus.split(' ');
      mount(focusFrame, html`<img src="${it.url}" alt="" draggable="false" /><span class="photo-focus__dot" style="left:${x};top:${y}"></span>`);
      focusFrame.setAttribute('aria-label', t('listing.focusLabel', { x: parseInt(x), y: parseInt(y) }));
    }
    if (notify) onChange();
  };

  grid.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!b) return;
    if (b.dataset.pick) selected = Number(b.dataset.pick);
    if (b.dataset.cover) {
      const [it] = items.splice(Number(b.dataset.cover), 1);
      items.unshift(it);
      selected = 0;
      arranged = true;
    }
    if (b.dataset.remove) {
      const [it] = items.splice(Number(b.dataset.remove), 1);
      if (it.id) removed.push(it.id);
      else (URL.revokeObjectURL(it.url), it.thumb && URL.revokeObjectURL(it.thumb));
      arranged = true;
    }
    draw();
  });

  fileInput.addEventListener('change', async () => {
    const files = [...(fileInput.files ?? [])];
    fileInput.value = '';
    const room = MAX_PHOTOS - items.length;
    if (files.length > room) photoStatus.textContent = t('listing.photosRoom', { n: room });
    for (const file of files.slice(0, room)) {
      photoStatus.textContent = t('listing.preparing');
      try {
        const prepared = await preparePhoto(file);
        items.push({ url: URL.createObjectURL(prepared.full), thumb: URL.createObjectURL(prepared.thumb), focus: '50% 40%', prepared });
        onAdd();
        selected = items.length - 1;
        photoStatus.textContent = '';
      } catch (err) {
        photoStatus.textContent = t(err instanceof PhotoError && err.message === 'too_small' ? 'listing.photoTooSmall' : 'listing.photoUnreadable');
      }
      draw();
    }
    if (files.length > room) photoStatus.textContent = t('listing.photosRoom', { n: room });
  });

  // Framing: tap where the face is. Arrow keys nudge it, for keyboards.
  const setFocus = (x: number, y: number) => {
    const it = items[selected];
    if (!it) return;
    const clamp = (v: number) => Math.round(Math.min(100, Math.max(0, v)));
    it.focus = `${clamp(x)}% ${clamp(y)}%`;
    if (it.id) arranged = true;
    draw();
  };
  focusFrame.addEventListener('click', (e) => {
    const img = focusFrame.querySelector('img');
    if (!img || e.detail === 0) return; // a keyboard "click" (Enter/Space) carries no position
    const r = img.getBoundingClientRect();
    setFocus(((e.clientX - r.left) / r.width) * 100, ((e.clientY - r.top) / r.height) * 100);
  });
  focusFrame.addEventListener('keydown', (e) => {
    const step = { ArrowLeft: [-5, 0], ArrowRight: [5, 0], ArrowUp: [0, -5], ArrowDown: [0, 5] }[e.key];
    if (!step) return;
    e.preventDefault();
    const [x, y] = (items[selected]?.focus ?? '50% 40%').split(' ').map((v) => parseInt(v));
    setFocus(x + step[0], y + step[1]);
    focusFrame.focus();
  });

  draw(false); // the form draws its own preview once it's bound
  return {
    items,
    /** Sends new photos, removals, then order and framing. If something fails halfway, the next call picks up
     *  where this one stopped. `progress` hears each upload (n of total). */
    async sync(target: PhotoTarget, progress: (n: number, total: number) => void) {
      const pending = items.filter((it) => !it.id);
      for (const [n, it] of pending.entries()) {
        progress(n + 1, pending.length);
        const saved = await target.upload({ image: await toBase64(it.prepared!.full), thumb: await toBase64(it.prepared!.thumb), focus: it.focus });
        URL.revokeObjectURL(it.url);
        if (it.thumb) URL.revokeObjectURL(it.thumb);
        Object.assign(it, { id: saved.id, url: saved.url, thumb: saved.thumb, prepared: undefined });
        arranged = true;
      }
      while (removed.length) {
        await target.remove(removed[0]);
        removed.shift();
      }
      if (arranged && items.length) await target.arrange(items.map((it) => ({ id: it.id!, focus: it.focus })));
      arranged = false;
    },
  };
}
