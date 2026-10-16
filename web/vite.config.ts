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
      return `export default ${JSON.stringify({ privacidad: read('privacidad.md'), terminos: read('terminos.md') })};`;
    },
  };
}

/** Fills index.html's %APP_NAME%, %APP_TAGLINE% and %APP_DESCRIPTION%, and serves or writes the manifest. */
function brand(): Plugin {
  return {
    name: 'brand',
    transformIndexHtml: (html) =>
      html
        .replaceAll('%APP_NAME%', escapeHtml(BRAND.name))
        .replaceAll('%APP_TAGLINE%', escapeHtml(BRAND.tagline))
        .replaceAll('%APP_DESCRIPTION%', escapeHtml(BRAND.description)),
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
