import { ChevronLeft, ChevronRight } from 'lucide';
import { api } from '../api';
import type { PetSummary } from '../data';
import { html, icon, reducedMotion, type Raw } from '../dom';
import { t } from '../i18n';
import { cachePets, petCache } from '../store';

// Going through a pet's photos, on the Explorar card and the profile: tap the left or right side of the
// photo (or its arrows), with pips showing which photo and how many. The list only says how many there
// are; the photos themselves come with the profile (cached at the edge), fetched on first need.

type Photo = { url: string | null; focus: string };

const pending = new Map<string, Promise<Photo[]>>();
/** Where each pet's gallery was left, so the profile opens on the photo the card was showing. */
const shownAt = new Map<string, number>();

export const photoCount = (pet: PetSummary) => Math.max(1, pet.photo.count ?? 1);

/** The pet's photos, from the profile already loaded or fetched once (without re-rendering the screen). */
export function photosOf(pet: PetSummary): Promise<Photo[]> {
  const cached = petCache.get(pet.id);
  if (cached && 'photos' in cached && cached.photos.length) return Promise.resolve(cached.photos);
  let p = pending.get(pet.id);
  if (!p) {
    p = api
      .pet(pet.id)
      .then((detail) => {
        cachePets(detail.siblings);
        petCache.set(pet.id, detail);
        return detail.photos;
      })
      .catch(() => [{ url: pet.photo.url, focus: pet.photo.focus }])
      .finally(() => pending.delete(pet.id));
    pending.set(pet.id, p);
  }
  return p;
}

/** Pips and arrows over the photo, for pets with more than one. On the card the arrows only show the way
 *  (the card handles taps itself, and keys there mean skip or adopt); on the profile they're real buttons. */
export function galleryControls(pet: PetSummary, mode: 'card' | 'profile'): Raw {
  const n = photoCount(pet);
  if (n < 2) return html``;
  const passive = mode === 'card' ? html`tabindex="-1" aria-hidden="true"` : '';
  return html`
    <div class="gallery gallery--${mode}" data-gallery>
      <span class="gallery__pips" aria-hidden="true">${Array.from({ length: n }, (_, i) => html`<i class="${i === 0 ? 'is-on' : ''}"></i>`)}</span>
      <button class="gallery__arrow gallery__arrow--prev" type="button" data-gallery-step="-1" aria-label="${t('gallery.prev')}" hidden ${passive}>${icon(ChevronLeft, 22)}</button>
      <button class="gallery__arrow gallery__arrow--next" type="button" data-gallery-step="1" aria-label="${t('gallery.next')}" ${passive}>${icon(ChevronRight, 22)}</button>
      ${mode === 'profile' ? html`<span class="sr-only" aria-live="polite" data-gallery-status></span>` : ''}
    </div>`;
}

export type Gallery = { step: (delta: number) => void; count: number };

/** Wires the gallery inside `scope` (a rendered canvas). */
export function bindGallery(scope: HTMLElement, pet: PetSummary, mode: 'card' | 'profile'): Gallery | null {
  const count = photoCount(pet);
  const ui = scope.querySelector<HTMLElement>('[data-gallery]');
  const img = scope.querySelector<HTMLImageElement>('.canvas__picture img');
  if (count < 2 || !ui || !img) return null;
  const pips = [...ui.querySelectorAll<HTMLElement>('.gallery__pips i')];
  const prev = ui.querySelector<HTMLButtonElement>('[data-gallery-step="-1"]')!;
  const next = ui.querySelector<HTMLButtonElement>('[data-gallery-step="1"]')!;
  const status = ui.querySelector<HTMLElement>('[data-gallery-status]');
  let index = 0;

  const show = async (i: number, announce = true) => {
    const photos = await photosOf(pet);
    const last = Math.min(count, photos.length) - 1;
    if (i < 0 || i > last) return bump(i < 0 ? -1 : 1);
    index = i;
    shownAt.set(pet.id, i);
    const photo = photos[i];
    if (photo.url) img.src = photo.url;
    img.style.objectPosition = photo.focus;
    pips.forEach((p, k) => p.classList.toggle('is-on', k === i));
    prev.hidden = i === 0;
    next.hidden = i === last;
    if (status && announce) status.textContent = t('gallery.status', { n: i + 1, total: last + 1 });
    // Load the one after, so the next tap is instant.
    const ahead = photos[i + 1]?.url;
    if (ahead) new Image().src = ahead;
  };
  /** At either end: a small nudge instead of nothing, so the tap visibly registered. */
  const bump = (dir: number) => {
    if (reducedMotion()) return;
    img.animate([{ translate: '0 0' }, { translate: `${dir * 10}px 0` }, { translate: '0 0' }], { duration: 220, easing: 'ease-out' });
  };
  const step = (delta: number) => void show(index + delta);

  if (mode === 'profile') {
    ui.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-gallery-step]');
      if (b) step(Number(b.dataset.galleryStep));
    });
    // Taps on the photo's sides work here too, like on the card.
    scope.querySelector('.canvas__picture')?.addEventListener('click', (e) => {
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const x = ((e as MouseEvent).clientX - r.left) / r.width;
      if (x < 0.33) step(-1);
      else if (x > 0.67) step(1);
    });
    const start = shownAt.get(pet.id) ?? 0;
    if (start) void show(start, false);
  } else {
    shownAt.delete(pet.id); // a fresh card starts on the cover
    // Warm up the second photo for the first tap.
    void photosOf(pet).then((photos) => photos[1]?.url && (new Image().src = photos[1].url));
  }
  return { step, count };
}
