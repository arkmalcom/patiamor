import { Check, RotateCcw, Search as SearchIcon, Share2, X } from 'lucide';
import { api } from '../api';
import { $, $$, html, icon, mount, type Raw } from '../dom';
import { away, t } from '../i18n';
import { fold, searchPets } from '../search';
import { activeRequestFor, cachePets, loadPets, placed, placePet, state, type Placed } from '../store';
import type { PetSummary } from '../data';
import { age, listerLabel, miniFrame } from '../ui/canvas';
import { shareSite } from '../ui/share';

// Buscar (/buscar?q=…): for someone who saw an animal elsewhere (an Instagram post, a flyer) and wants to
// find it here by name, or by shelter or area. It searches whatever the person's filters, species switch
// or distance, and shows enough of each animal to tell similar ones apart. The search lives in the
// address, so coming back from a profile finds the same results.
//
// Two steps, so it stays instant. First the animals the app already holds (the nearest 1,000 open to
// requests, nationwide), answered as you type. If that finds no animal by that name, or the server cut the
// list so some may be missing, the database is asked too (a spinner shows meanwhile) and its answer joins
// the local ones. Adopted and withdrawn animals are never shown.

interface SearchDeps {
  openProfile: (id: string) => void;
}

/** Fewer letters than this would match almost everything. */
const MIN_LETTERS = 2;
/** The database is only asked about words of at least this many letters (the server refuses fewer). */
const ASK_LETTERS = 3;
/** How long the typing must pause before the database is asked. */
const PAUSE_MS = 300;

/** Database answers this visit, by what was typed, so typing back and forth doesn't ask again. */
const answers = new Map<string, PetSummary[]>();
const asking = new Map<string, Promise<PetSummary[]>>();

const keyOf = (q: string) => fold(q);
const askable = (q: string) => keyOf(q).split(' ').some((w) => w.length >= ASK_LETTERS);

function ask(q: string): Promise<PetSummary[]> {
  const key = keyOf(q);
  const pending = asking.get(key);
  if (pending) return pending;
  const call = api
    .findPets(key)
    .then((pets) => {
      cachePets(pets); // so opening one has its card ready
      answers.set(key, pets);
      return pets;
    })
    .finally(() => asking.delete(key));
  asking.set(key, call);
  return call;
}

/** The animals the app holds plus whatever the database added for this search. */
function everything(q: string): Placed[] {
  const known = new Set(placed.map((p) => p.pet.id));
  const extra = (answers.get(keyOf(q)) ?? []).filter((p) => !known.has(p.id)).map(placePet);
  return [...placed, ...extra];
}

const bits = (p: Placed) => {
  const { pet } = p;
  return [t(`listing.species.${pet.species}`), t(`sex.${pet.sex}`), age(pet), t(`size.${pet.size}`), t('search.energy', { level: t(`energy.${pet.energy}`).toLowerCase() })].join(' · ');
};

/** What's known to be good about the animal, as short tags. */
function tags(p: Placed): Raw {
  const { pet } = p;
  const good: string[] = [];
  if (pet.health.vaccinated) good.push(t('listing.vaccinated'));
  if (pet.health.sterilized) good.push(t('listing.sterilized'));
  if (pet.health.dewormed) good.push(t('listing.dewormed'));
  const who = (['ninos', 'perros', 'gatos'] as const).filter((c) => pet.goodWith[c === 'ninos' ? 'kids' : c === 'perros' ? 'dogs' : 'cats'] === true).map((c) => t(`companion.${c}`).toLowerCase());
  if (who.length) good.push(t('search.goodWith', { who: who.join(', ') }));
  return html`${pet.status === 'reserved' ? html`<li class="result__tag--process">${t('search.inProcess')}</li>` : ''}${good.map((g) => html`<li>${icon(Check, 13)}${g}</li>`)}${activeRequestFor(pet.id) ? html`<li class="result__tag--list">${t('search.inList')}</li>` : ''}`;
}

function row(p: Placed): Raw {
  const { pet } = p;
  return html`
    <li>
      <button class="result" type="button" data-open="${pet.id}" aria-label="${t('deck.profile')}: ${pet.name}">
        ${miniFrame(pet, 'md')}
        <span class="result__text">
          <strong class="result__name">${pet.name}</strong>
          <span class="result__bits">${bits(p)}</span>
          <span class="result__where">${listerLabel(pet)}<span>${[...new Set([pet.place.name, pet.place.municipality])].join(', ')} · ${away(p.km)}</span></span>
          <ul class="result__tags">${tags(p)}</ul>
        </span>
      </button>
    </li>`;
}

/** Whether the database should be asked: nothing local is named so, or the list was cut and may hide some. */
const needsDatabase = (q: string, named: number) => askable(q) && !answers.has(keyOf(q)) && (named === 0 || state.petsTruncated);

type Asking = 'idle' | 'looking' | 'failed';

function results(q: string, asking: Asking): Raw {
  if (state.petsStatus === 'error' && !state.pets.length) {
    return html`<p class="passed__empty">${t('deck.error')}</p><button class="button button--primary" type="button" data-retry>${t('deck.retry')}</button>`;
  }
  if (state.petsStatus !== 'ready' && !state.pets.length) return html`<p class="loading-note" role="status">${t('search.loading')}</p>`;
  const query = q.trim();
  if (query.length < MIN_LETTERS) return html`<p class="muted search__hint">${t('search.hint')}</p>`;

  const { matches, similar } = searchPets(everything(query), query);
  // While the database is being asked, "nothing found" would be wrong: say we're looking instead.
  const status =
    asking === 'looking'
      ? html`<p class="search__looking" role="status"><span class="spinner" aria-hidden="true"></span>${t('search.looking', { q: query })}</p>`
      : asking === 'failed'
        ? html`<div class="search__failed" role="alert"><p>${t('search.lookFailed')}</p><button class="button button--outline button--small" type="button" data-retry-find>${icon(RotateCcw, 16)}${t('deck.retry')}</button></div>`
        : '';
  if (!matches.length && !similar.length && asking === 'idle') return none(query);
  return html`
    ${status}
    ${matches.length
      ? html`<p class="search__count" role="status">${t(matches.length === 1 ? 'search.count.one' : 'search.count.many', { n: matches.length })}</p>
          <ul class="results">${matches.map(row)}</ul>`
      : asking === 'idle'
        ? html`<p class="search__count" role="status">${t('search.noExact', { q: query })}</p>`
        : ''}
    ${similar.length
      ? html`<h2 class="search__similar">${t('search.similar')}</h2>
          <p class="muted">${t('search.similarNote')}</p>
          <ul class="results">${similar.map(row)}</ul>`
      : ''}`;
}

/** Nothing close, here or in the database. Most likely it isn't published (yet): ask to tell its shelter. */
function none(q: string): Raw {
  return html`
    <div class="search__none">
      <h2 class="search__none-title">${t('search.none.title', { q })}</h2>
      <p>${t('search.none.body')}</p>
      <div class="recruit">
        <p class="recruit__title">${t('search.none.recruit')}</p>
        <div class="recruit__actions">
          <button class="button button--outline button--small" type="button" data-share-site>${icon(Share2, 16)}${t('empty.recruit.share')}</button>
          <a class="button button--ghost button--small" href="/refugio/registro">${t('empty.recruit.register')}</a>
        </div>
      </div>
    </div>`;
}

export function renderSearch(root: HTMLElement, q: string, deps: SearchDeps) {
  // A re-render (pets finished loading, a request changed) shouldn't drop the field out from under the keyboard.
  const typing = document.activeElement instanceof HTMLInputElement && root.contains(document.activeElement) && document.activeElement.dataset.searchInput !== undefined;
  let step: Asking = 'idle';
  let timer = 0;
  let turn = 0; // which search an answer belongs to: an older one arriving late is ignored

  mount(
    root,
    html`
      <section class="search" aria-labelledby="search-title">
        <h1 class="page-title" id="search-title">${t('search.title')}</h1>
        <p class="search__lede">${t('search.lede')}</p>
        <form class="search__form" role="search" data-form>
          <label class="search__field">
            <span class="sr-only">${t('search.label')}</span>
            ${icon(SearchIcon, 20)}
            <input class="search__input" type="search" name="q" value="${q}" placeholder="${t('search.placeholder')}" autocomplete="off" autocapitalize="words" spellcheck="false" enterkeyhint="search" data-search-input data-autofocus />
            <button class="icon-button search__clear" type="button" data-clear-search aria-label="${t('search.clear')}" ${q ? '' : 'hidden'}>${icon(X, 18)}</button>
          </label>
        </form>
        <div data-results aria-live="polite"></div>
      </section>`,
  );
  const input = $<HTMLInputElement>('[data-search-input]', root);
  const clear = $<HTMLButtonElement>('[data-clear-search]', root);
  const box = $('[data-results]', root);

  const paint = (value: string) => {
    mount(box, results(value, step));
    $$<HTMLButtonElement>('[data-open]', box).forEach((b) => b.addEventListener('click', () => deps.openProfile(b.dataset.open!)));
    box.querySelector('[data-share-site]')?.addEventListener('click', () => void shareSite());
    box.querySelector('[data-retry]')?.addEventListener('click', () => void loadPets());
    box.querySelector('[data-retry-find]')?.addEventListener('click', () => lookUp(value, 0));
  };

  /** Asks the database after the typing pauses, with the spinner showing until it answers. */
  const lookUp = (value: string, wait = PAUSE_MS) => {
    const mine = ++turn;
    window.clearTimeout(timer);
    step = 'looking';
    paint(value);
    timer = window.setTimeout(() => {
      ask(value).then(
        () => mine === turn && ((step = 'idle'), paint(value)),
        () => mine === turn && ((step = 'failed'), paint(value)),
      );
    }, wait);
  };

  /** Shows the answer for what's typed: locally at once, and from the database too when that's needed. */
  const show = (value: string) => {
    turn++;
    window.clearTimeout(timer);
    step = 'idle';
    clear.hidden = !value;
    // In the address, so the back button from a profile returns to these results.
    history.replaceState(null, '', value.trim() ? `/buscar?q=${encodeURIComponent(value)}` : '/buscar');
    const ready = state.petsStatus === 'ready' || state.pets.length > 0;
    const named = ready && value.trim().length >= MIN_LETTERS ? searchPets(everything(value), value).named.length : 0;
    if (ready && value.trim().length >= MIN_LETTERS && needsDatabase(value, named)) lookUp(value);
    else paint(value);
  };

  input.addEventListener('input', () => show(input.value));
  clear.addEventListener('click', () => {
    input.value = '';
    show('');
    input.focus();
  });
  $('[data-form]', root).addEventListener('submit', (e) => {
    e.preventDefault();
    input.blur(); // "Buscar" on the phone's keyboard: hide it to see the results
  });
  show(q);
  if (typing) {
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }
}
