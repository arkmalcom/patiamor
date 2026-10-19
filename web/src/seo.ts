import { BRAND } from './brand';

// What search engines and the browser tab are told about each page. The app is one HTML page that draws
// itself, so the title, description, canonical address and "don't list this" flag follow the route here.
// Crawlers that run the page (Google, Bing) read the result. A pet's page also gets its own tags from the
// Worker before the script runs (api/src/share.ts), which is what link previews read.

/** Where pages are listed: production's address (VITE_SITE_URL, set by the production deploy), or wherever this runs. */
const SITE = (import.meta.env.VITE_SITE_URL as string | undefined)?.replace(/\/$/, '') || location.origin;

export type Page = {
  /** The tab's title, whole; left alone when missing. */
  title?: string;
  /** Left alone when missing. */
  description?: string;
  /** Whether search engines may list it; left alone when missing (a pet's page decides for itself, from the Worker). */
  index?: boolean;
};

/** The title of a page other than the front page: "Buscar · Patiamor". */
export const titled = (title: string) => `${title} · ${BRAND.name}`;

/** The front page's title. */
export const frontTitle = `${BRAND.name} · ${BRAND.tagline}`;

function head(selector: string, create: () => HTMLElement) {
  let el = document.head.querySelector<HTMLElement>(selector);
  if (!el) document.head.append((el = create()));
  return el;
}

function element(tag: string, attrs: Record<string, string>) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

export function setPage({ title, description, index }: Page) {
  if (title !== undefined) document.title = title;
  if (description !== undefined) head('meta[name="description"]', () => element('meta', { name: 'description' })).setAttribute('content', description);
  // The same page under /x and /x/ is one page.
  const path = location.pathname.length > 1 ? location.pathname.replace(/\/$/, '') : '/';
  head('link[rel="canonical"]', () => element('link', { rel: 'canonical' })).setAttribute('href', SITE + path);
  // Only the flag this script added is ever removed: one from the Worker (staging, an animal that went home) stays.
  const ours = document.head.querySelector('meta[name="robots"][data-seo]');
  if (index === false && !ours) document.head.append(element('meta', { name: 'robots', content: 'noindex', 'data-seo': '' }));
  if (index === true) ours?.remove();
}
