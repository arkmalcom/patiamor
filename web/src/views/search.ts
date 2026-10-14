import { Check, Search as SearchIcon, Share2, X } from 'lucide';
import { $, $$, html, icon, mount, type Raw } from '../dom';
import { animals, away, t } from '../i18n';
import { searchPets } from '../search';
import { activeRequestFor, loadPets, placed, state, type Placed } from '../store';
import { age, listerLabel, miniFrame } from '../ui/canvas';
import { shareSite } from '../ui/share';

// Buscar (/buscar?q=…): for someone who saw an animal elsewhere (an Instagram post, a flyer) and wants to
// find it here by name, or by shelter or area. It searches every animal Patiamor holds, whatever the
// person's filters, species switch or distance, and shows enough of each to tell similar ones apart. The
// search lives in the address, so coming back from a profile finds the same results.

interface SearchDeps {
  openProfile: (id: string) => void;
}

/** Fewer letters than this would match almost everything. */
const MIN_LETTERS = 2;

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
  return html`${good.map((g) => html`<li>${icon(Check, 13)}${g}</li>`)}${activeRequestFor(pet.id) ? html`<li class="result__tag--list">${t('search.inList')}</li>` : ''}`;
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

function results(q: string): Raw {
  if (state.petsStatus === 'error' && !state.pets.length) {
    return html`<p class="passed__empty">${t('deck.error')}</p><button class="button button--primary" type="button" data-retry>${t('deck.retry')}</button>`;
  }
  if (state.petsStatus !== 'ready' && !state.pets.length) return html`<p class="loading-note" role="status">${t('search.loading')}</p>`;
  const query = q.trim();
  if (query.length < MIN_LETTERS) {
    return html`<p class="muted search__hint">${t('search.hint', { n: placed.length, animals: animals(placed.length, 'todos') })}</p>`;
  }
  const { matches, similar } = searchPets(placed, query);
  if (!matches.length && !similar.length) return none(query);
  return html`
    ${matches.length
      ? html`<p class="search__count" role="status">${t(matches.length === 1 ? 'search.count.one' : 'search.count.many', { n: matches.length })}</p>
          <ul class="results">${matches.map(row)}</ul>`
      : html`<p class="search__count" role="status">${t('search.noExact', { q: query })}</p>`}
    ${similar.length
      ? html`<h2 class="search__similar">${t('search.similar')}</h2>
          <p class="muted">${t('search.similarNote')}</p>
          <ul class="results">${similar.map(row)}</ul>`
      : ''}`;
}

/** Nothing close. Most likely it isn't published here (yet), so ask the person to tell its shelter. */
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
        <div data-results aria-live="polite">${results(q)}</div>
      </section>`,
  );
  const input = $<HTMLInputElement>('[data-search-input]', root);
  const clear = $<HTMLButtonElement>('[data-clear-search]', root);
  const box = $('[data-results]', root);

  const bind = () => {
    $$<HTMLButtonElement>('[data-open]', box).forEach((b) => b.addEventListener('click', () => deps.openProfile(b.dataset.open!)));
    box.querySelector('[data-share-site]')?.addEventListener('click', () => void shareSite());
    box.querySelector('[data-retry]')?.addEventListener('click', () => void loadPets());
  };
  const show = (value: string) => {
    mount(box, results(value));
    clear.hidden = !value;
    // In the address, so the back button from a profile returns to these results.
    history.replaceState(null, '', value.trim() ? `/buscar?q=${encodeURIComponent(value)}` : '/buscar');
    bind();
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
  bind();
  if (typing) {
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }
}
