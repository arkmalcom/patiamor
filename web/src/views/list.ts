import { Compass, Footprints } from 'lucide';
import { $$, html, icon, mount, type Raw } from '../dom';
import { formatDate, t, away } from '../i18n';
import { MAX_SLOTS, placePet, state, type Answer, type SavedItem } from '../store';
import { listerLabel, miniFrame } from '../ui/canvas';
import { pips, removeFromList } from '../ui/save';

interface ListDeps {
  openProfile: (id: string) => void;
  explore: () => void;
}

const answerTag = (label: string, a: Answer) =>
  html`<li class="answer answer--${a}"><span>${label}</span><strong>${a === 'si' ? t('reflect.yes') : t('reflect.unsure')}</strong></li>`;

function filled(s: SavedItem, compact: boolean): Raw {
  const { pet } = s;
  const p = placePet(pet);
  const who = pet.lister.type === 'shelter' ? pet.lister.name : t('lister.privateWho');
  const gone = pet.status !== 'available';
  return html`
    <li class="slot slot--filled">
      <button class="slot__open" type="button" data-open="${pet.id}" aria-label="${t('deck.profile')}: ${pet.name}">${miniFrame(pet, compact ? 'sm' : 'md')}</button>
      <div class="slot__text">
        <h2 class="slot__name">${pet.name}</h2>
        <p class="muted">${away(p.km)} · ${listerLabel(pet)}</p>
        ${gone ? html`<p class="slot__gone">${t('list.unavailable')}</p>` : ''}
        ${compact
          ? ''
          : html`
              <p class="slot__date">${t('list.savedOn', { date: formatDate(s.savedAt.slice(0, 10)) })}</p>
              <ul class="answers" aria-label="${t('list.answers')}">
                ${answerTag(t('list.answer.space'), s.answers.space)}
                ${answerTag(t('list.answer.time'), s.answers.time)}
                ${answerTag(t('list.answer.cost'), s.answers.cost)}
              </ul>
              <div class="next-step">
                ${icon(Footprints, 18)}
                <p><strong>${t('list.next')}:</strong> ${t('list.nextBody', { shelter: who })}</p>
              </div>
              <div class="slot__actions">
                <button class="button button--outline button--small" type="button" data-open="${pet.id}">${t('deck.profile')}</button>
                <button class="button button--ghost button--small" type="button" data-release="${pet.id}">${t('full.release')}</button>
              </div>`}
      </div>
    </li>`;
}

const empty = (compact: boolean) => html`
  <li class="slot slot--empty">
    <span class="slot__blank" aria-hidden="true"></span>
    <div class="slot__text">
      <p class="slot__name slot__name--empty">${t('list.empty')}</p>
      ${compact ? '' : html`<p class="muted">${t('list.emptyHint')}</p>`}
    </div>
  </li>`;

export function slots(compact = false): Raw {
  return html`<ol class="slots ${compact ? 'slots--compact' : ''}">${Array.from({ length: MAX_SLOTS }, (_, i) =>
    state.saved[i] ? filled(state.saved[i], compact) : empty(compact),
  )}</ol>`;
}

export function bindSlots(root: HTMLElement, deps: ListDeps) {
  $$<HTMLButtonElement>('[data-open]', root).forEach((b) => b.addEventListener('click', () => deps.openProfile(b.dataset.open!)));
  $$<HTMLButtonElement>('[data-release]', root).forEach((b) => b.addEventListener('click', () => removeFromList(b.dataset.release!)));
}

export function renderList(root: HTMLElement, deps: ListDeps) {
  mount(
    root,
    html`
      <section class="list-view" aria-labelledby="list-title">
        <header class="list-view__head">
          <h1 class="page-title" id="list-title" tabindex="-1" data-focus>${t('list.title')}</h1>
          <span class="list-view__count">${pips()}<span>${t('list.slots', { n: state.saved.length })}</span></span>
        </header>
        <p class="list-view__lede">${t('list.body')}</p>
        ${!state.signedIn && !state.saved.length ? html`<p class="sample-note">${t('list.signedOut')}</p>` : ''}
        ${slots()}
        <button class="button button--outline" type="button" data-explore>${icon(Compass, 20)}${t('list.explore')}</button>
      </section>`,
  );
  bindSlots(root, deps);
  root.querySelector('[data-explore]')!.addEventListener('click', deps.explore);
}
