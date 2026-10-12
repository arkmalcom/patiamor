import { Clock, Heart, SlidersHorizontal } from 'lucide';
import { $, html, icon, mount, reducedMotion, type Raw } from '../dom';
import { formatKm, t } from '../i18n';
import { activeFilterCount, nextRadius, queue, state, update } from '../store';
import { canvas } from '../ui/canvas';
import { startSave } from '../ui/save';
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
      <div class="deck-empty__frame" aria-hidden="true"><span></span></div>
      <h1 class="deck-empty__title" tabindex="-1" data-focus>${t('empty.title')}</h1>
      <p class="muted">${t('empty.body', { km: state.radiusKm })}</p>
      <div class="deck-empty__actions">
        ${wider ? html`<button class="button button--primary" type="button" data-widen="${wider}">${t('empty.widen', { km: wider })}</button>` : ''}
        ${hasSkipped ? html`<button class="button button--outline" type="button" data-again>${t('empty.again')}</button>` : ''}
        ${activeFilterCount() ? html`<button class="button button--ghost" type="button" data-filters>${icon(SlidersHorizontal, 18)}${t('empty.filters')}</button>` : ''}
      </div>
    </div>`;
}

export function renderDeck(root: HTMLElement, deps: DeckDeps) {
  const q = queue();
  if (!q.length) {
    mount(root, html`<section class="deck deck--empty">${emptyState()}</section>`);
    root.querySelector<HTMLButtonElement>('[data-widen]')?.addEventListener('click', (e) => {
      const km = Number((e.currentTarget as HTMLElement).dataset.widen);
      update((s) => (s.radiusKm = km));
    });
    root.querySelector('[data-again]')?.addEventListener('click', () => update((s) => (s.skipped = [])));
    root.querySelector('[data-filters]')?.addEventListener('click', () => update((s) => (s.filters = { size: [], age: [], sex: [], energy: [], goodWith: [] })));
    return;
  }

  const [top, ...rest] = q;
  const behind = rest.slice(0, 2);
  const total = q.length;
  mount(
    root,
    html`
      <section class="deck" aria-labelledby="deck-title">
        <h1 class="sr-only" id="deck-title" tabindex="-1" data-focus>${t('nav.explore')}</h1>
        <div class="deck__stack">
          ${behind
            .map((p, i) => html`<div class="card card--behind card--behind-${i + 1}" aria-hidden="true" inert>${canvas(p, { index: i + 1, loading: 'eager' })}</div>`)
            .reverse()}
          <article class="card card--top" tabindex="0" data-card
            aria-label="${top.dog.name}, ${t('deck.away', { km: formatKm(top.km) })}"
            aria-describedby="deck-keys">
            ${canvas(top, { index: 0, photoName: 'dog-photo' })}
            ${stamps()}
          </article>
        </div>
        <p class="sr-only" id="deck-keys">${t('deck.keyboard')}</p>
        <div class="deck__actions">
          <button class="button button--outline deck__skip" type="button" data-skip title="${t('deck.skipHint')}">${icon(Clock, 20)}<span>${t('deck.skip')}</span></button>
          <button class="button button--ghost deck__profile" type="button" data-profile>${t('deck.profile')}</button>
          <button class="button button--primary deck__save" type="button" data-save>${icon(Heart, 20)}<span>${t('deck.save')}</span></button>
        </div>
        <p class="deck__position">${t('deck.position', { n: 1, total })}</p>
      </section>`,
  );

  const card = $('[data-card]', root);
  const skipStamp = $('.stamp--skip', card);
  const saveStamp = $('.stamp--save', card);

  const skip = (fromX = 0) => {
    const go = () => {
      update((s) => s.skipped.push(top.dog.id));
      toast(t('deck.skipped', { name: top.dog.name }), {
        label: t('deck.undo'),
        run: () => update((s) => (s.skipped = s.skipped.filter((id) => id !== top.dog.id))),
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

  const save = () => {
    card.classList.add('is-considering');
    startSave(top.dog.id, (saved) => {
      card.classList.remove('is-considering');
      if (!saved) return;
      // Re-render happens through the store; let the card rise toward "Mi lista" first.
      if (!reducedMotion()) card.animate([{ transform: 'none' }, { transform: 'translateY(-24px) scale(.92)', opacity: 0 }], { duration: 260, easing: EASE_OUT, fill: 'forwards' });
    });
  };

  // Drag physics. A drag left sets the dog aside; a drag right opens the reflection, never an instant save.
  let startX = 0;
  let startY = 0;
  let dx = 0;
  let dy = 0;
  let dragging = false;
  card.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    startX = e.clientX;
    startY = e.clientY;
    dx = dy = 0;
    dragging = false;
    card.setPointerCapture(e.pointerId);
  });
  card.addEventListener('pointermove', (e) => {
    if (!card.hasPointerCapture(e.pointerId)) return;
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
  card.addEventListener('lostpointercapture', () => {
    card.classList.remove('is-dragging');
    if (!dragging) {
      deps.openProfile(top.dog.id);
      return;
    }
    if (dx < -THRESHOLD) return skip(dx);
    springBack(dx, dy * 0.2);
    if (dx > THRESHOLD) save();
  });

  card.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') (e.preventDefault(), skip());
    else if (e.key === 'ArrowRight') (e.preventDefault(), save());
    else if (e.key === 'Enter' || e.key === ' ') (e.preventDefault(), deps.openProfile(top.dog.id));
  });

  $('[data-skip]', root).addEventListener('click', () => skip());
  $('[data-save]', root).addEventListener('click', save);
  $('[data-profile]', root).addEventListener('click', () => deps.openProfile(top.dog.id));
}

