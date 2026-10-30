import { Compass, Eye } from 'lucide';
import { frameFor } from '../data';
import { $$, html, icon, mount, type Raw } from '../dom';
import { away, formatDate, sentence, t } from '../i18n';
import { activeRequests, isOpen, MAX_SLOTS, petCache, placePet, state, type Answer, type MyRequest } from '../store';
import { listerLabel, miniFrame, photo } from '../ui/canvas';
import { kindTag, listerName, lo, openWithdraw, requestStatus, statusKey } from '../ui/request';
import { bulkWhat, openBulk } from '../ui/bulk';
import { helpInvite } from '../ui/help-invite';
import { pips } from '../ui/save';

// Mi lista: three slots, each an adoption request in progress, plus the ones that ended recently and,
// in a second view, the pets passed on this session ("Vistos antes"), shown as a list.

interface ListDeps {
  openProfile: (id: string) => void;
  explore: () => void;
}

const answerTag = (label: string, a: Answer) =>
  html`<li class="answer answer--${a}"><span>${label}</span><strong>${a === 'si' ? t('reflect.yes') : t('reflect.unsure')}</strong></li>`;

function filled(s: MyRequest, compact: boolean): Raw {
  const { pet } = s;
  const p = placePet(pet);
  return html`
    <li class="slot slot--filled">
      <button class="slot__open" type="button" data-open="${pet.id}" aria-label="${t('deck.profile')}: ${pet.name}">${miniFrame(pet, compact ? 'sm' : 'md')}</button>
      <div class="slot__text">
        <h2 class="slot__name">${pet.name}</h2>
        <p class="muted">${away(p.km)} · ${listerLabel(pet)}</p>
        ${kindTag(s.request) ? html`<p class="slot__kind">${kindTag(s.request)}</p>` : ''}
        ${compact
          ? html`<p class="slot__status">${sentence(t(`request.status.${statusKey(s) as 'sent'}`, { lister: listerName(pet), name: pet.name, lo: lo(pet) }))}</p>`
          : html`
              ${requestStatus(s)}
              <ul class="answers" aria-label="${t('list.answers')}">
                ${answerTag(t('list.answer.space'), s.answers.space)}
                ${answerTag(t('list.answer.time'), s.answers.time)}
                ${answerTag(t('list.answer.cost'), s.answers.cost)}
              </ul>
              <div class="slot__actions">
                <button class="button button--outline button--small" type="button" data-open="${pet.id}">${t('deck.profile')}</button>
                ${s.request.status === 'fostering' ? '' : html`<button class="button button--ghost button--small" type="button" data-withdraw="${s.request.id}">${t('request.withdraw')}</button>`}
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
  const open = activeRequests();
  return html`<ol class="slots ${compact ? 'slots--compact' : ''}">${Array.from({ length: MAX_SLOTS }, (_, i) => (open[i] ? filled(open[i], compact) : empty(compact)))}</ol>`;
}

/** Under the slots: "¿Quieres adoptar a más de tres?", or where their special request stands. */
function bulkSection(): Raw {
  if (!state.signedIn) return html``;
  const b = state.bulk;
  if (!b) {
    return html`
      <section class="many bulk-prompt" aria-labelledby="bulk-title">
        <h2 class="many__title" id="bulk-title">${t('bulk.promptTitle')}</h2>
        <p>${t('bulk.promptBody')}</p>
        <button class="button button--outline" type="button" data-bulk>${t('bulk.promptCta')}</button>
      </section>`;
  }
  const what = bulkWhat(b.species);
  return html`
    <section class="bulk-card bulk-card--${b.status}" aria-labelledby="bulk-title" role="status">
      <h2 class="bulk-card__title" id="bulk-title">${t(`bulk.status.${b.status}`)}</h2>
      <p>${t(`bulk.status.${b.status}.body`, { n: b.animals, what, email: state.user?.email ?? '' })}</p>
      ${b.note ? html`<p class="bulk-card__note">${b.status === 'declined' ? html`<strong>${t('bulk.status.reason')}:</strong> ` : ''}${b.note}</p>` : ''}
      <p class="bulk-card__date">${t('request.sentOn', { date: formatDate(b.createdAt.slice(0, 10)) })}</p>
      ${b.status === 'declined' ? html`<button class="text-button" type="button" data-bulk>${t('bulk.again')}</button>` : ''}
    </section>`;
}

/** Requests that ended in the last 30 days: how things turned out, never a mystery. */
function ended(): Raw {
  const done = state.requests.filter((r) => !isOpen(r.request)).reverse();
  if (!done.length) return html``;
  return html`
    <section class="ended" aria-labelledby="ended-title">
      <h2 class="section-title" id="ended-title">${t('list.ended')}</h2>
      <ul class="ended__list">
        ${done.map(
          (s) => html`<li class="ended__item">
            <button class="slot__open" type="button" data-open="${s.pet.id}" aria-label="${t('deck.profile')}: ${s.pet.name}">${miniFrame(s.pet, 'sm')}</button>
            <div class="ended__text"><strong>${s.pet.name}</strong>${requestStatus(s)}</div>
          </li>`,
        )}
      </ul>
    </section>`;
}

/** "Vistos antes": this session's skipped pets. They return to Explorar next visit, and leave this list then. */
function passed(): Raw {
  const pets = state.skipped.map((id) => petCache.get(id)).filter((p) => !!p);
  if (!pets.length) return html`<p class="passed__empty">${t('list.passedEmpty')}</p>`;
  return html`
    <p class="muted">${t('list.passedNote')}</p>
    <ul class="passed">
      ${pets.map((pet) => {
        const p = placePet(pet);
        return html`<li class="passed__item">
          <button class="slot__open" type="button" data-open="${pet.id}" aria-label="${t('deck.profile')}: ${pet.name}">${miniFrame(pet, 'sm')}</button>
          <div class="passed__text">
            <strong class="passed__name">${pet.name}</strong>
            <span class="muted">${away(p.km)} · ${listerLabel(pet)}</span>
          </div>
          <div class="passed__actions">
            <button class="button button--outline button--small" type="button" data-open="${pet.id}">${icon(Eye, 16)}${t('deck.profile')}</button>
          </div>
        </li>`;
      })}
    </ul>`;
}

export function bindSlots(root: HTMLElement, deps: ListDeps) {
  $$<HTMLButtonElement>('[data-open]', root).forEach((b) => b.addEventListener('click', () => deps.openProfile(b.dataset.open!)));
  $$<HTMLButtonElement>('[data-withdraw]', root).forEach((b) =>
    b.addEventListener('click', () => {
      const item = state.requests.find((x) => x.request.id === b.dataset.withdraw);
      if (item) openWithdraw(item);
    }),
  );
}

/** "Tu casa": one painted facade with three windows, open with a pet looking out or shut while empty. */
function casa(): Raw {
  const open = activeRequests();
  const windows = Array.from({ length: MAX_SLOTS }, (_, i) => {
    const s = open[i];
    return s
      ? html`<span class="casa__window is-open" data-frame="${frameFor(s.pet.id)}"><span class="casa__shutter"></span><span class="casa__pane">${photo(s.pet, 'lazy', true)}</span><span class="casa__shutter"></span></span>`
      : html`<span class="casa__window" data-frame="anil"><span class="casa__pane"><span class="casa__shut"></span><span class="casa__shut"></span></span></span>`;
  });
  return html`<div class="casa" aria-hidden="true"><span class="casa__cornice"></span><span class="casa__wall"><span class="casa__windows">${windows}</span><span class="casa__door"></span></span></div>`;
}

export function renderList(root: HTMLElement, deps: ListDeps) {
  const showPassed = location.pathname.startsWith('/lista/pasados');
  const open = activeRequests();
  mount(
    root,
    html`
      <section class="list-view" aria-labelledby="list-title">
        <header class="list-view__head">
          <h1 class="page-title" id="list-title" tabindex="-1" data-focus>${t('list.title')}</h1>
          <span class="list-view__count">${pips()}<span>${t('list.slots', { n: open.length })}</span></span>
        </header>
        <nav class="list-tabs" aria-label="${t('list.title')}">
          <a class="list-tabs__tab" href="/lista" aria-current="${showPassed ? 'false' : 'page'}">${t('list.tab.requests')}</a>
          <a class="list-tabs__tab" href="/lista/pasados" aria-current="${showPassed ? 'page' : 'false'}">${t('list.tab.passed')}${state.skipped.length ? html` <span class="list-tabs__count">${state.skipped.length}</span>` : ''}</a>
        </nav>
        ${showPassed
          ? passed()
          : html`
              ${casa()}
              <p class="list-view__lede">${t('list.body')}</p>
              ${!state.signedIn && !open.length ? html`<p class="sample-note">${t('list.signedOut')}</p>` : ''}
              ${slots()}
              ${bulkSection()}
              ${ended()}
              ${open.length ? '' : helpInvite()}`}
        <button class="button button--outline" type="button" data-explore>${icon(Compass, 20)}${t('list.explore')}</button>
      </section>`,
  );
  bindSlots(root, deps);
  root.querySelector('[data-bulk]')?.addEventListener('click', openBulk);
  root.querySelector('[data-explore]')!.addEventListener('click', deps.explore);
}
