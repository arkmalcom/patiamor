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
        miniflare: { bindings: { TEST_MIGRATIONS: migrations, ENVIRONMENT: 'test', APP_ORIGIN: 'http://example.test' } },
      }),
    ],
    test: { setupFiles: ['./test/setup.ts'] },
  };
});
