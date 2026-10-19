import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import { BRAND } from './src/brand';

/** The installed app's name and colours (Add to Home Screen). Built from brand.ts, so a rename is one file. */
const manifest = () =>
  JSON.stringify(
    {
      name: BRAND.name,
      short_name: BRAND.name,
      description: BRAND.description,
      lang: 'es-DO',
      start_url: '/',
      scope: '/',
      display: 'standalone',
      background_color: '#E3F1F4',
      theme_color: '#E3F1F4',
      icons: [
        { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    },
    null,
    2,
  );

/** The production address (the deploy sets VITE_SITE_URL). Without it (local, staging) the page declares no site. */
const SITE_URL = process.env.VITE_SITE_URL?.replace(/\/$/, '');

/** schema.org data so search results can show the product's name, and its logo, instead of the bare domain. */
const structuredData = () =>
  JSON.stringify({
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'WebSite', '@id': `${SITE_URL}/#site`, name: BRAND.name, url: `${SITE_URL}/`, description: BRAND.description, inLanguage: 'es-DO' },
      { '@type': 'Organization', '@id': `${SITE_URL}/#org`, name: BRAND.name, url: `${SITE_URL}/`, logo: `${SITE_URL}/icons/icon-512.png`, email: BRAND.contactEmail },
    ],
  }).replaceAll('<', '\\u003c'); // never closes the script tag

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** The privacy policy and the terms, from docs/legal/ (the one place they're written), as `virtual:legal`. */
function legal(): Plugin {
  const id = 'virtual:legal';
  return {
    name: 'legal',
    resolveId: (source) => (source === id ? `\0${id}` : null),
    load(resolved) {
      if (resolved !== `\0${id}`) return null;
      const read = (file: string) => {
        const path = fileURLToPath(new URL(`../docs/legal/${file}`, import.meta.url));
        this.addWatchFile(path);
        return readFileSync(path, 'utf8');
      };
      const texts = { privacidad: read('privacidad.md'), terminos: read('terminos.md'), privacy: read('privacy.en.md'), terms: read('terms.en.md') };
      return `export default ${JSON.stringify(texts)};`;
    },
  };
}

/** Fills index.html's %APP_NAME%, %APP_TAGLINE% and %APP_DESCRIPTION% (and adds the site's structured data), and serves or writes the manifest. */
function brand(): Plugin {
  return {
    name: 'brand',
    transformIndexHtml: (html) => ({
      html: html
        .replaceAll('%APP_NAME%', escapeHtml(BRAND.name))
        .replaceAll('%APP_TAGLINE%', escapeHtml(BRAND.tagline))
        .replaceAll('%APP_DESCRIPTION%', escapeHtml(BRAND.description)),
      tags: SITE_URL ? [{ tag: 'script', attrs: { type: 'application/ld+json' }, children: structuredData(), injectTo: 'head' as const }] : [],
    }),
    configureServer(server) {
      server.middlewares.use('/manifest.webmanifest', (_req, res) => {
        res.setHeader('Content-Type', 'application/manifest+json');
        res.end(manifest());
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'manifest.webmanifest', source: manifest() });
    },
  };
}

// `pnpm run dev` serves the app with hot reload on :5173 and forwards /api to the local Worker
// (`npm run dev` in api/, on :8788), so local development runs against real data and sign-in.
export default defineConfig({
  plugins: [brand(), legal()],
  server: {
    port: 5173,
    proxy: { '/api': { target: 'http://localhost:8788', changeOrigin: true } },
  },
});
