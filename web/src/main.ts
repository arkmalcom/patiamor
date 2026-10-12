import '@fontsource/shrikhand/latin-400.css';
import '@fontsource-variable/atkinson-hyperlegible-next/wght.css';
import './styles.css';

import { Compass, MapPin, SlidersHorizontal, User } from 'lucide';
import { landscape } from './art';
import { $, $$, html, icon, mount, transition } from './dom';
import { t } from './i18n';
import { activeFilterCount, here, state, subscribe } from './store';
import { applyFooter, bindRadiusPanel, radiusPanel } from './ui/radius';
import { mountPips, pips } from './ui/save';
import { closeSheet, initSheet, openSheet, sheetEl } from './ui/sheet';
import { initToast } from './ui/toast';
import { renderAccount } from './views/account';
import { renderDeck } from './views/deck';
import { bindSlots, renderList, slots } from './views/list';
import { renderProfile } from './views/profile';

type Route = { name: 'deck' } | { name: 'profile'; id: string } | { name: 'list' } | { name: 'account' };

function parse(hash: string): Route {
  const [, a, b] = hash.replace(/^#/, '').split('/');
  if (a === 'perro' && b) return { name: 'profile', id: decodeURIComponent(b) };
  if (a === 'lista') return { name: 'list' };
  if (a === 'cuenta') return { name: 'account' };
  return { name: 'deck' };
}

const go = (path: string) => (location.hash = path);
const openProfile = (id: string) => go(`/perro/${encodeURIComponent(id)}`);
const explore = () => go('/');

const app = $('#app');
mount(
  app,
  html`
    ${landscape}
    <a class="skip-link" href="#view">Saltar al contenido</a>
    <header class="topbar">
      <a class="wordmark" href="#/" aria-label="${t('app.name')}, ${t('nav.explore')}">${t('app.name')}<span class="wordmark__demo">${t('app.demo')}</span></a>
      <nav class="topnav" aria-label="Principal">
        <a href="#/" data-nav="deck">${t('nav.explore')}</a>
        <a href="#/lista" data-nav="list">${t('nav.list')} <span data-pips data-pips-count>${pips(true)}</span></a>
        <a href="#/cuenta" data-nav="account">${t('nav.account')}</a>
      </nav>
      <div class="topbar__tools">
        <button class="radius-chip" type="button" data-open-radius aria-label="${t('radius.open')}">${icon(MapPin, 18)}<span><span class="radius-chip__place" data-radius-place></span><span data-radius-label></span></span></button>
        <button class="icon-button filters-button" type="button" data-open-radius aria-label="${t('filters.button')}">${icon(SlidersHorizontal, 22)}<span class="badge" data-filter-badge hidden></span></button>
      </div>
    </header>
    <aside class="side side--filters" aria-label="${t('sheet.radius.title')}" data-side-filters></aside>
    <main class="view" id="view" tabindex="-1"></main>
    <aside class="side side--list" aria-labelledby="side-list-title">
      <h2 class="panel-title" id="side-list-title"><a href="#/lista">${t('list.title')}</a> <span data-pips data-pips-count>${pips(true)}</span></h2>
      <p class="muted">${t('list.body')}</p>
      <div data-side-slots></div>
    </aside>
    <nav class="tabbar" aria-label="Principal">
      <a href="#/" data-nav="deck">${icon(Compass, 24)}<span>${t('nav.explore')}</span></a>
      <a href="#/lista" data-nav="list"><span class="tabbar__pips" data-pips data-pips-count>${pips(true)}</span><span>${t('nav.list')}</span></a>
      <a href="#/cuenta" data-nav="account">${icon(User, 24)}<span>${t('nav.account')}</span></a>
    </nav>
  `,
);

initSheet();
initToast();

const view = $('#view');
const inlinePanel = $('[data-side-filters]');
mount(inlinePanel, radiusPanel('inline'));
const inline = bindRadiusPanel(inlinePanel, { mode: 'inline' });

function openRadiusSheet() {
  if (matchMedia('(min-width: 1100px)').matches && parse(location.hash).name === 'deck') {
    $<HTMLInputElement>('[data-radius]', inlinePanel).focus();
    return;
  }
  const dialog = openSheet(t('sheet.radius.title'), radiusPanel('sheet'), { footer: applyFooter() });
  bindRadiusPanel($('.radius-panel', dialog), { mode: 'sheet', onApply: closeSheet });
}
$$('[data-open-radius]').forEach((b) => b.addEventListener('click', openRadiusSheet));

function chrome(route: Route) {
  document.documentElement.dataset.route = route.name;
  $('[data-radius-place]').textContent = `${here.label} · `;
  $('[data-radius-label]').textContent = t('radius.chip', { km: state.radiusKm });
  const n = activeFilterCount();
  const badge = $('[data-filter-badge]');
  badge.hidden = n === 0;
  badge.textContent = String(n);
  $$('[data-pips]').forEach(mountPips);
  $$<HTMLAnchorElement>('[data-nav]').forEach((a) => {
    const active = a.dataset.nav === route.name || (route.name === 'profile' && a.dataset.nav === 'deck');
    if (active) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  const side = $('[data-side-slots]');
  mount(side, slots(true));
  bindSlots(side, { openProfile, explore });
}

function render(route = parse(location.hash)) {
  chrome(route);
  switch (route.name) {
    case 'deck':
      return renderDeck(view, { openProfile });
    case 'profile':
      return renderProfile(view, route.id, { back: () => (history.length > 1 ? history.back() : explore()) });
    case 'list':
      return renderList(view, { openProfile, explore });
    case 'account':
      return renderAccount(view);
  }
}

let current = parse(location.hash);
window.addEventListener('hashchange', () => {
  const next = parse(location.hash);
  const morph = (current.name === 'deck' && next.name === 'profile') || (current.name === 'profile' && next.name === 'deck');
  current = next;
  if (sheetEl().open) sheetEl().close();
  const run = () => {
    render(next);
    window.scrollTo(0, 0);
  };
  (morph ? transition(run) : (run(), Promise.resolve())).then(() => {
    view.querySelector<HTMLElement>('[data-focus], h1')?.focus({ preventScroll: true });
  });
});

subscribe(() => {
  render(current);
  inline.refresh();
});

render(current);
