import '@fontsource/shrikhand/latin-400.css';
import '@fontsource-variable/atkinson-hyperlegible-next/wght.css';
import './styles.css';

import { Compass, MapPin, SlidersHorizontal, User } from 'lucide';
import { landscape } from './art';
import { $, $$, html, icon, mount, transition } from './dom';
import { t } from './i18n';
import { activeFilterCount, loadPets, setLocation, setUser, state, subscribe, update } from './store';
import { applyFooter, bindRadiusPanel, radiusPanel } from './ui/radius';
import { mountPips, pips, resumePendingSave } from './ui/save';
import { closeSheet, initSheet, openSheet, sheetEl } from './ui/sheet';
import { initToast, toast } from './ui/toast';
import { api, ApiError } from './api';
import { errorText } from './ui/auth';
import { renderAccount } from './views/account';
import { renderDeck } from './views/deck';
import { bindSlots, renderList, slots } from './views/list';
import { renderProfile } from './views/profile';

type Route = { name: 'deck' } | { name: 'profile'; id: string } | { name: 'list' } | { name: 'account' };

function parse(hash: string): Route {
  const [, a, b] = hash.replace(/^#/, '').split('?')[0].split('/');
  if (a === 'mascota' && b) return { name: 'profile', id: decodeURIComponent(b) };
  if (a === 'lista') return { name: 'list' };
  if (a === 'cuenta') return { name: 'account' };
  return { name: 'deck' };
}

const go = (path: string) => (location.hash = path);
const openProfile = (id: string) => go(`/mascota/${encodeURIComponent(id)}`);
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
  $('[data-radius-place]').textContent = state.location ? `${state.location.name} · ` : '';
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
      return renderProfile(view, route.id, { back: () => (history.length > 1 ? history.back() : explore()), openProfile });
    case 'list':
      return renderList(view, { openProfile, explore });
    case 'account':
      return renderAccount(view);
  }
}

// A one-tap link from the sign-in email lands on #/entrar?t=…&next=…. Take the token off the URL before
// anything renders, then post it; the server only signs in on that POST, never on the link's GET.
const linkParams = location.hash.startsWith('#/entrar?') ? new URLSearchParams(location.hash.split('?')[1]) : null;
const linkToken = linkParams?.get('t') ?? null;
if (linkParams) {
  const next = linkParams.get('next') ?? '';
  history.replaceState(null, '', location.pathname + (/^#\/[\w\-/%]*$/.test(next) ? next : '#/'));
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

// Sign-in state lives on the server; errors from a sign-in redirect arrive as ?error=… on the hash.
const returnParams = new URLSearchParams(location.hash.split('?')[1] ?? '');
const authError = returnParams.get('error');
const justSignedIn = returnParams.has('signedin');
if (authError) toast(errorText(authError));
if (authError || justSignedIn) history.replaceState(null, '', location.pathname + location.hash.split('?')[0]);
// Where to measure distances from: the saved area, or Cloudflare's coarse IP location (Gazcue outside the DR).
if (state.location) void loadPets();
else
  api
    .whereami()
    .then(({ place }) => setLocation(place))
    .catch(() => update((s) => (s.petsStatus = 'error')));

const signedIn = linkToken
  ? api.emailLink(linkToken).then(
      (user) => (toast(t('auth.signedIn', { who: user.name ?? user.email })), user),
      (err) => (toast(errorText(err instanceof ApiError && err.code === 'link' ? 'link' : 'network')), api.me()),
    )
  : api.me().then((user) => (user && justSignedIn && toast(t('auth.signedIn', { who: user.name ?? user.email })), user));
signedIn
  .then((user) => {
    setUser(user);
    void resumePendingSave();
  })
  .catch(() => {
    /* API unreachable (e.g. static preview): stay signed out */
  });
