import '@fontsource/shrikhand/latin-400.css';
import '@fontsource-variable/atkinson-hyperlegible-next/wght.css';
import './styles.css';

import { Compass, MapPin, Search, SlidersHorizontal, User } from 'lucide';
import { backdrop, landscape } from './art';
import { $, $$, html, icon, mount, transition } from './dom';
import { kmLabel, t } from './i18n';
import { activeFilterCount, loadPets, loadRequests, radius, setLocation, setUser, state, subscribe, takePendingRequest, update } from './store';
import { applyFooter, bindRadiusPanel, radiusPanel } from './ui/radius';
import { resumePendingRequest } from './ui/request';
import { mountPips, pips } from './ui/save';
import { closeSheet, initSheet, openSheet, sheetEl } from './ui/sheet';
import { initToast, toast } from './ui/toast';
import { api, ApiError } from './api';
import { here, isAppPath, navigate, startNavigation, upgradeHashLink } from './nav';
import { errorText } from './ui/auth';
import { renderAccount } from './views/account';
import { renderDeck } from './views/deck';
import { bindSlots, renderList, slots } from './views/list';
import { renderPortal, type PortalView } from './views/portal';
import { renderProfile } from './views/profile';
import { renderSearch } from './views/search';

upgradeHashLink();

type Route = { name: 'deck' } | { name: 'profile'; id: string } | { name: 'search'; q: string } | { name: 'list' } | { name: 'account' } | ({ name: 'portal' } & PortalView);

/** The route for an in-app path (here()): "/mascota/luna", "/refugio/x/animales?ver=adoptados"… */
function parse(where: string): Route {
  const [path, query = ''] = where.split('?');
  const [, a, b, c, d] = path.split('/');
  if (a === 'mascota' && b) return { name: 'profile', id: decodeURIComponent(b) };
  // The shelter portal: /refugio, /refugio/registro, /refugio/<id>/editar, /refugio/admin?estado=…
  if (a === 'refugio') {
    if (b === 'registro') return { name: 'portal', view: 'registro' };
    if (b === 'admin' && c === 'grandes') {
      const estado = new URLSearchParams(query).get('estado');
      return { name: 'portal', view: 'adminBulk', status: (['pending', 'approved', 'declined'] as const).find((s) => s === estado) ?? 'pending' };
    }
    if (b === 'admin') {
      const estado = new URLSearchParams(query).get('estado');
      return { name: 'portal', view: 'admin', status: (['pending', 'verified', 'rejected', 'suspended'] as const).find((s) => s === estado) ?? 'pending' };
    }
    if (b && c === 'editar') return { name: 'portal', view: 'editar', id: decodeURIComponent(b) };
    // A shelter's animals: /refugio/<id>/animales, …/animales/nuevo, …/animales/<petId>. Lists keep
    // their tab in ?ver=…, so a re-render (any store update) stays on it.
    const ver = new URLSearchParams(query).get('ver');
    if (b && c === 'solicitudes') return { name: 'portal', view: 'solicitudes', id: decodeURIComponent(b), tab: ver };
    if (b && c === 'animales')
      return d ? { name: 'portal', view: 'animal', id: decodeURIComponent(b), petId: d === 'nuevo' ? null : decodeURIComponent(d) } : { name: 'portal', view: 'animales', id: decodeURIComponent(b), tab: ver };
    return { name: 'portal', view: 'home' };
  }
  if (a === 'buscar') return { name: 'search', q: new URLSearchParams(query).get('q') ?? '' };
  if (a === 'lista') return { name: 'list' };
  if (a === 'cuenta') return { name: 'account' };
  return { name: 'deck' };
}

const openProfile = (id: string) => navigate(`/mascota/${encodeURIComponent(id)}`);
const explore = () => navigate('/');

const app = $('#app');
mount(
  app,
  html`
    ${backdrop}
    ${landscape}
    <a class="skip-link" href="#view">Saltar al contenido</a>
    <header class="topbar">
      <a class="wordmark" href="/" aria-label="${t('app.name')}, ${t('nav.explore')}">${t('app.name')}<span class="wordmark__demo">${t('app.demo')}</span></a>
      <nav class="topnav" aria-label="Principal">
        <a href="/" data-nav="deck">${t('nav.explore')}</a>
        <a href="/buscar" data-nav="search">${t('nav.search')}</a>
        <a href="/lista" data-nav="list">${t('nav.list')} <span data-pips data-pips-count>${pips(true)}</span></a>
        <a href="/cuenta" data-nav="account" data-account-top>${t('nav.account')}</a>
      </nav>
      <div class="topbar__tools">
        <button class="radius-chip" type="button" data-open-radius aria-label="${t('radius.open')}">${icon(MapPin, 18)}<span><span class="radius-chip__place" data-radius-place></span><span data-radius-label></span></span></button>
        <button class="icon-button filters-button" type="button" data-open-radius aria-label="${t('filters.button')}">${icon(SlidersHorizontal, 22)}<span class="badge" data-filter-badge hidden></span></button>
      </div>
    </header>
    <aside class="side side--filters" aria-label="${t('sheet.radius.title')}" data-side-filters></aside>
    <main class="view" id="view" tabindex="-1"></main>
    <aside class="side side--list" aria-labelledby="side-list-title">
      <h2 class="panel-title" id="side-list-title"><a href="/lista">${t('list.title')}</a> <span data-pips data-pips-count>${pips(true)}</span></h2>
      <p class="muted">${t('list.body')}</p>
      <div data-side-slots></div>
    </aside>
    <nav class="tabbar" aria-label="Principal">
      <a href="/" data-nav="deck">${icon(Compass, 24)}<span>${t('nav.explore')}</span></a>
      <a href="/buscar" data-nav="search">${icon(Search, 24)}<span>${t('nav.search')}</span></a>
      <a href="/lista" data-nav="list"><span class="tabbar__pips" data-pips data-pips-count>${pips(true)}</span><span>${t('nav.list')}</span></a>
      <a href="/cuenta" data-nav="account" data-account-tab>${icon(User, 24)}<span>${t('nav.account')}</span></a>
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
  if (matchMedia('(min-width: 1100px)').matches && parse(here()).name === 'deck') {
    $<HTMLInputElement>('[data-radius]', inlinePanel).focus();
    return;
  }
  const dialog = openSheet(t('sheet.radius.title'), radiusPanel('sheet'), { footer: applyFooter() });
  bindRadiusPanel($('.radius-panel', dialog), { mode: 'sheet', onApply: closeSheet });
}
$$('[data-open-radius]').forEach((b) => b.addEventListener('click', openRadiusSheet));

/** Who's signed in, at a glance: an initial and a first name where "Cuenta" would be. */
function account() {
  const user = state.user;
  const top = $<HTMLAnchorElement>('[data-account-top]');
  const tab = $<HTMLAnchorElement>('[data-account-tab]');
  if (!user) {
    mount(top, html`${t('nav.account')}`);
    mount(tab, html`${icon(User, 24)}<span>${t('nav.account')}</span>`);
    top.removeAttribute('aria-label');
    tab.removeAttribute('aria-label');
    return;
  }
  const first = user.name?.trim().split(/\s+/)[0] || null;
  const initial = (user.name?.trim() || user.email).charAt(0).toUpperCase();
  const label = first ?? t('nav.myAccount');
  const avatar = html`<span class="avatar" aria-hidden="true">${initial}</span>`;
  mount(top, html`${avatar}<span>${label}</span>`);
  mount(tab, html`${avatar}<span class="tabbar__name">${label}</span>`);
  const aria = t('nav.signedInAs', { who: user.name ? `${user.name} (${user.email})` : user.email });
  top.setAttribute('aria-label', aria);
  tab.setAttribute('aria-label', aria);
}

function chrome(route: Route) {
  document.documentElement.dataset.route = route.name;
  // The background's motifs follow the species switch: paws and bones, yarn and fish, or both.
  document.documentElement.dataset.species = state.species;
  $('[data-radius-place]').textContent = state.location ? `${state.location.name} · ` : '';
  $('[data-radius-label]').textContent = kmLabel(radius(), true);
  const n = activeFilterCount();
  const badge = $('[data-filter-badge]');
  badge.hidden = n === 0;
  badge.textContent = String(n);
  $$('[data-pips]').forEach(mountPips);
  account();
  $$<HTMLAnchorElement>('[data-nav]').forEach((a) => {
    const active = a.dataset.nav === route.name || (route.name === 'profile' && a.dataset.nav === 'deck') || (route.name === 'portal' && a.dataset.nav === 'account');
    if (active) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  const side = $('[data-side-slots]');
  mount(side, slots(true));
  bindSlots(side, { openProfile, explore });
}

function render(route = parse(here())) {
  chrome(route);
  switch (route.name) {
    case 'deck':
      return renderDeck(view, { openProfile });
    case 'profile':
      return renderProfile(view, route.id, { back: () => (history.length > 1 ? history.back() : explore()), openProfile });
    case 'search':
      return renderSearch(view, route.q, { openProfile });
    case 'list':
      return renderList(view, { openProfile, explore });
    case 'account':
      return renderAccount(view);
    case 'portal':
      return renderPortal(view, route);
  }
}

// A one-tap link from the sign-in email lands on /entrar?t=…&next=…. Take the token off the URL before
// anything renders, then post it; the server only signs in on that POST, never on the link's GET.
const linkParams = location.pathname === '/entrar' ? new URLSearchParams(location.search) : null;
const linkToken = linkParams?.get('t') ?? null;
if (linkParams) {
  // Links sent before PAT-32 carry a hash route ("#/lista") as next.
  const next = (linkParams.get('next') ?? '').replace(/^#/, '');
  history.replaceState(null, '', isAppPath(next) ? next : '/');
}

let current = parse(here());
startNavigation(() => {
  const next = parse(here());
  const morph = (current.name === 'deck' && next.name === 'profile') || (current.name === 'profile' && next.name === 'deck');
  current = next;
  if (sheetEl().open) sheetEl().close();
  // Shelters move requests along while the app is open: opening Mi lista fetches where they stand now.
  if (next.name === 'list' && state.signedIn) void loadRequests().catch(() => {});
  const run = () => {
    render(next);
    window.scrollTo(0, 0);
  };
  (morph ? transition(run) : (run(), Promise.resolve())).then(() => {
    (view.querySelector<HTMLElement>('[data-autofocus]') ?? view.querySelector<HTMLElement>('[data-focus], h1'))?.focus({ preventScroll: true });
  });
});

subscribe(() => {
  // The URL as it is now: a list records its tab with replaceState, which doesn't navigate.
  current = parse(here());
  render(current);
  inline.refresh();
});

render(current);

// Sign-in state lives on the server; errors from a sign-in redirect arrive as ?error=… on the URL.
const returnParams = new URLSearchParams(location.search);
const authError = returnParams.get('error');
const justSignedIn = returnParams.has('signedin');
if (authError) toast(errorText(authError));
if (authError || justSignedIn) history.replaceState(null, '', location.pathname);
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
    void resumePendingRequest(takePendingRequest());
  })
  .catch(() => {
    /* API unreachable (e.g. static preview): stay signed out */
  });
