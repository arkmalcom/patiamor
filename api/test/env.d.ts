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
