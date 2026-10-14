import path from 'node:path';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

// API tests run inside the Workers runtime (Miniflare) against a local D1 with every migration applied.
export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.join(import.meta.dirname, 'migrations'));
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.jsonc', environment: 'staging' },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            ENVIRONMENT: 'test',
            APP_ORIGIN: 'http://example.test',
            // Cloudflare's published Turnstile test keys; tests stub the siteverify call itself.
            TURNSTILE_SITE_KEY: '1x00000000000000000000AA',
            TURNSTILE_SECRET: '1x0000000000000000000000000000000AA',
          },
        },
      }),
    ],
    test: { setupFiles: ['./test/setup.ts'] },
  };
});
