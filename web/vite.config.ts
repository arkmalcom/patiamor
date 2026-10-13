import { defineConfig } from 'vite';

// `pnpm run dev` serves the app with hot reload on :5173 and forwards /api to the local Worker
// (`npm run dev` in api/, on :8788), so local development runs against real data and sign-in.
export default defineConfig({
  server: {
    port: 5173,
    proxy: { '/api': { target: 'http://localhost:8788', changeOrigin: true } },
  },
});
