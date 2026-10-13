import { Clock, Heart, SlidersHorizontal } from 'lucide';
import { $, html, icon, mount, reducedMotion, type Raw } from '../dom';
import { animals, away, t } from '../i18n';
import { activeFilterCount, emptyFilters, loadPets, nextRadius, queue, state, update } from '../store';
import { canvas } from '../ui/canvas';
import { bindSpeciesSwitch, speciesSwitch } from '../ui/species';
import { toast } from '../ui/toast';

interface DeckDeps {
  openProfile: (id: string) => void;
}

const THRESHOLD = 96;
const EASE_OUT = 'cubic-bezier(.16,1,.3,1)';

function stamps(): Raw {
  return html`
    <span class="stamp stamp--skip" aria-hidden="true">${icon(Clock, 18)}${t('deck.dragSkip')}</span>
    <span class="stamp stamp--save" aria-hidden="true">${icon(Heart, 18)}${t('deck.dragSave')}</span>`;
}

function emptyState(): Raw {
  const wider = nextRadius();
  const hasSkipped = state.skipped.length > 0;
  return html`
    <div class="deck-empty">
      ${emptyFrame()}
      <h1 class="deck-empty__title" tabindex="-1" data-focus>${t('empty.title')}</h1>
      <p class="muted">${t('empty.body', { km: state.radiusKm, animals: animals(2, state.species) })}</p>
      <div class="deck-empty__actions">
        ${wider ? html`<button class="button button--primary" type="button" data-widen="${wider}">${t('empty.widen', { km: wider })}</button>` : ''}
        ${hasSkipped ? html`<button class="button button--outline" type="button" data-again>${t('empty.again')}</button>` : ''}
        ${activeFilterCount() ? html`<button class="button button--ghost" type="button" data-filters>${icon(SlidersHorizontal, 18)}${t('empty.filters')}</button>` : ''}
      </div>
    </div>`;
}

/** An empty portrait frame (gently breathing while pets load). */
const emptyFrame = (loading = false) =>
  html`<div class="empty-frame${loading ? ' is-loading' : ''}" data-frame="mango" aria-hidden="true"><span class="empty-frame__canvas"></span></div>`;

export function renderDeck(root: HTMLElement, deps: DeckDeps) {
  if (state.petsStatus !== 'ready' && !state.pets.length) {
    const failed = state.petsStatus === 'error';
    mount(
      root,
      html`<section class="deck deck--empty">${speciesSwitch()}<div class="deck-empty">
        ${emptyFrame(!failed)}
        <h1 class="deck-empty__title" tabindex="-1" data-focus>${failed ? t('deck.error') : t('deck.loading', { animals: animals(2, state.species) })}</h1>
        ${failed ? html`<button class="button button--primary" type="button" data-retry>${t('deck.retry')}</button>` : ''}
      </div></section>`,
    );
    root.querySelector('[data-retry]')?.addEventListener('click', () => void (state.location ? loadPets() : location.reload()));
    bindSpeciesSwitch(root);
    return;
  }
  const q = queue();
  if (!q.length) {
    mount(root, html`<section class="deck deck--empty">${speciesSwitch()}${emptyState()}</section>`);
    bindSpeciesSwitch(root);
    root.querySelector<HTMLButtonElement>('[data-widen]')?.addEventListener('click', (e) => {
      const km = Number((e.currentTarget as HTMLElement).dataset.widen);
      update((s) => (s.radiusKm = km));
    });
    root.querySelector('[data-again]')?.addEventListener('click', () => update((s) => (s.skipped = [])));
    root.querySelector('[data-filters]')?.addEventListener('click', () => update((s) => (s.filters = emptyFilters())));
    return;
  }

  const [top, ...rest] = q;
  const total = q.length;
  // Windows don't stack; the next photos just load ahead so the next window opens instantly.
  for (const p of rest.slice(0, 2)) if (p.pet.photo.url) new Image().src = p.pet.photo.url;
  mount(
    root,
    html`
      <section class="deck" aria-labelledby="deck-title">
        ${speciesSwitch()}
        <h1 class="sr-only" id="deck-title" tabindex="-1" data-focus>${t('nav.explore')}</h1>
        <div class="deck__stack">
          <article class="card card--top" tabindex="0" data-card
            aria-label="${top.pet.name}, ${away(top.km)}"
            aria-describedby="deck-keys">
            ${canvas(top, { photoName: 'pet-photo' })}
            ${stamps()}
          </article>
        </div>
        <p class="sr-only" id="deck-keys">${t('deck.keyboard')}</p>
        <div class="deck__actions">
          <button class="button button--outline deck__skip" type="button" data-skip title="${t('deck.skipHint')}">${icon(Clock, 20)}<span>${t('deck.skip')}</span></button>
          <button class="button button--primary deck__save" type="button" data-save>${icon(Heart, 20)}<span>${t('deck.save')}</span></button>
        </div>
        <p class="deck__position">${t('deck.position', { n: 1, total })}</p>
      </section>`,
  );

  bindSpeciesSwitch(root);
  const card = $('[data-card]', root);
  const skipStamp = $('.stamp--skip', card);
  const saveStamp = $('.stamp--save', card);

  const skip = (fromX = 0) => {
    const go = () => {
      update((s) => s.skipped.push(top.pet.id));
      toast(t('deck.skipped', { name: top.pet.name }), {
        label: t('deck.undo'),
        run: () => update((s) => (s.skipped = s.skipped.filter((id) => id !== top.pet.id))),
      });
    };
    if (reducedMotion()) return go();
    card
      .animate(
        [{ transform: `translateX(${fromX}px) rotate(${fromX * 0.05}deg)` }, { transform: `translateX(-130%) rotate(-16deg)`, opacity: 0.2 }],
        { duration: 320, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' },
      )
      .finished.then(go);
  };

  const springBack = (fromX: number, fromY: number) => {
    card.style.transform = '';
    skipStamp.style.opacity = saveStamp.style.opacity = '';
    if (reducedMotion() || (!fromX && !fromY)) return;
    card.animate([{ transform: `translate(${fromX}px, ${fromY}px) rotate(${fromX * 0.05}deg)` }, { transform: 'none' }], { duration: 420, easing: EASE_OUT });
  };

  // "Quiero adoptar" never commits on the spot: it opens the full profile, which ends with the one place
  // to start the process. The photo morphs from the card into the profile.
  const save = () => deps.openProfile(top.pet.id);

  // Drag physics. A drag left sets the pet aside; a drag right opens the full profile, never an instant request.
  let startX = 0;
  let startY = 0;
  let dx = 0;
  let dy = 0;
  let dragging = false;
  // The drag ends on whichever arrives first: pointerup, pointercancel, a release elsewhere on the page,
  // or the window losing focus. Relying on one event alone can leave the card frozen mid-drag.
  let pointerId: number | null = null;
  const end = (kind: 'release' | 'cancel') => {
    if (pointerId === null) return;
    const id = pointerId;
    pointerId = null;
    window.removeEventListener('pointerup', onWindowUp);
    window.removeEventListener('blur', onBlur);
    if (card.hasPointerCapture(id)) card.releasePointerCapture(id);
    card.classList.remove('is-dragging');
    if (kind === 'cancel') return springBack(dx, dy * 0.2);
    if (!dragging) return deps.openProfile(top.pet.id);
    if (dx < -THRESHOLD) return skip(dx);
    springBack(dx, dy * 0.2);
    if (dx > THRESHOLD) save();
  };
  const onWindowUp = (e: PointerEvent) => e.pointerId === pointerId && end('release');
  const onBlur = () => end('cancel');

  card.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || pointerId !== null) return;
    pointerId = e.pointerId;
    startX = e.clientX;
    startY = e.clientY;
    dx = dy = 0;
    dragging = false;
    card.setPointerCapture(e.pointerId);
    window.addEventListener('pointerup', onWindowUp);
    window.addEventListener('blur', onBlur);
  });
  card.addEventListener('pointermove', (e) => {
    if (e.pointerId !== pointerId) return;
    dx = e.clientX - startX;
    dy = e.clientY - startY;
    if (!dragging && Math.hypot(dx, dy) > 6) {
      dragging = true;
      card.classList.add('is-dragging');
    }
    if (!dragging) return;
    card.style.transform = `translate(${dx}px, ${dy * 0.2}px) rotate(${dx * 0.05}deg)`;
    skipStamp.style.opacity = String(Math.min(1, Math.max(0, -dx / THRESHOLD)));
    saveStamp.style.opacity = String(Math.min(1, Math.max(0, dx / THRESHOLD)));
  });
  card.addEventListener('pointerup', (e) => e.pointerId === pointerId && end('release'));
  card.addEventListener('pointercancel', (e) => e.pointerId === pointerId && end('cancel'));
  card.addEventListener('lostpointercapture', (e) => e.pointerId === pointerId && end('release'));

  card.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') (e.preventDefault(), skip());
    else if (e.key === 'ArrowRight') (e.preventDefault(), save());
    else if (e.key === 'Enter' || e.key === ' ') (e.preventDefault(), deps.openProfile(top.pet.id));
  });

  $('[data-skip]', root).addEventListener('click', () => skip());
  $('[data-save]', root).addEventListener('click', save);
}

