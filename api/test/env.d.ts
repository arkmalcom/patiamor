import type { D1Migration } from 'cloudflare:test';
import type { Env as AppEnv } from '../src/env';

// Types for `env` and `exports` from 'cloudflare:workers' inside tests.
declare global {
  namespace Cloudflare {
    interface Env extends AppEnv {
      TEST_MIGRATIONS: D1Migration[];
    }
    interface GlobalProps {
      mainModule: typeof import('../src/index');
    }
  }
}
export {};

// The legal texts are imported as raw text in tests (Vite's ?raw).
declare module '*.md?raw' {
  const text: string;
  export default text;
}
