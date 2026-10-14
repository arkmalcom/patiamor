// Real paths (/mascota/luna), not hash routes (/#/mascota/luna): WhatsApp, Facebook and other link
// previews only see what comes before a #, so a shared pet needs a path of its own (PAT-32). The Worker
// serves the app for every path; this module keeps navigation inside the app without page reloads.

/** Where the app is: the path and query, e.g. "/refugio/x/animales?ver=adoptados". */
export const here = () => location.pathname + location.search;

/** In-app paths only: one leading slash (never "//", which would point at another site), no #. */
export const isAppPath = (path: string) => /^\/(?!\/)[\w\-/%]*(\?[\w\-=&%.]*)?$/.test(path);

let onChange = () => {};

/** Goes to an in-app path, like following a link; `replace` swaps the current entry instead. */
export function navigate(path: string, opts: { replace?: boolean } = {}) {
  if (opts.replace) history.replaceState(null, '', path);
  else if (path === here()) return;
  else history.pushState(null, '', path);
  onChange();
}

/** Starts listening: `fn` runs on every in-app navigation, including the browser's back and forward. */
export function startNavigation(fn: () => void) {
  onChange = fn;
  window.addEventListener('popstate', () => onChange());
  // An old "#/…" link followed inside the open app changes only the hash: upgrade it like on load.
  window.addEventListener('hashchange', () => {
    if (!location.hash.startsWith('#/')) return;
    upgradeHashLink();
    onChange();
  });
  // Links to app paths navigate in place. New-tab clicks, downloads, other sites, /api/ and in-page
  // anchors (the skip link's #view) keep the browser's behaviour.
  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = (e.target as Element | null)?.closest?.('a');
    if (!a || a.target || a.hasAttribute('download')) return;
    const url = new URL(a.href, location.href);
    if (url.origin !== location.origin || url.pathname.startsWith('/api/') || (url.hash && url.pathname === location.pathname)) return;
    e.preventDefault();
    navigate(url.pathname + url.search);
  });
}

/** Links from before PAT-32 (emails, bookmarks: "/#/lista") become their path, before anything renders. */
export function upgradeHashLink() {
  if (location.hash.startsWith('#/')) history.replaceState(null, '', location.hash.slice(1));
}
