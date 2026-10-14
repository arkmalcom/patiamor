# First-time setup

Steps marked **(owner)** are things only the owner can do. Everything else Claude can do; for production resources, ask first.

## 1. API token (owner)

In the Cloudflare dashboard, go to **My Profile → API Tokens → Create Token → Create Custom Token**:

| Permission | Level | Why |
|---|---|---|
| Account · Workers Scripts | Edit | Deploy the Worker, manage versions and secrets |
| Account · D1 | Edit | Create databases, run migrations and queries |
| Account · Workers Tail | Read | Stream logs |
| Account · Account Settings | Read | Lets wrangler resolve the account |
| User · User Details | Read | `wrangler whoami` |
| Zone · Workers Routes | Edit | Attach the Worker to patiamor.com (zone: patiamor.com only) |
| Zone · DNS | Read | Inspect DNS without being able to change it |

- **Account resources:** include only the Patiamor account.
- **Zone resources:** include only `patiamor.com`. Add it once the domain is registered.
- Set an **expiry date** and rotate the token when it expires.
- DNS is deliberately read-only. When a DNS change is needed, Claude proposes it and the owner applies it, or the owner temporarily grants DNS Edit.

Create `.env` at the repo root (it's gitignored):

```
PATIAMOR_CLOUDFLARE_API_TOKEN=<token>
PATIAMOR_CLOUDFLARE_ACCOUNT_ID=<account id from the dashboard sidebar>
# R2 S3-style credentials (only for S3 clients/scripts; the Worker uses an R2 binding)
PATIAMOR_CLOUDFLARE_ACCESS_KEY_ID=
PATIAMOR_CLOUDFLARE_SECRET_ACCESS_KEY=
PATIAMOR_CLOUDFLARE_S3_API_ENDPOINT=
```

Verify with `.claude/skills/cloudflare/scripts/cf whoami`.

## 2. Scaffold the Worker (`api/`)

```bash
mkdir -p api && cd api
npm init -y
npm i hono
npm i -D wrangler@4 typescript @cloudflare/workers-types
```

To keep the wrapper using the pinned version, add `"scripts": { "dev": "wrangler dev", "deploy": "wrangler deploy" }` and run `npx wrangler types` after any binding change. That generates `worker-configuration.d.ts` for typed `env.DB`.

`api/wrangler.jsonc`, the starting point. Check it against the `$schema` and `cf deploy --dry-run`:

```jsonc
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": "patiamor",
  "main": "src/index.ts",
  "compatibility_date": "2026-10-01",
  "compatibility_flags": ["nodejs_compat"],
  "observability": { "enabled": true },
  "assets": {
    "directory": "../web/dist",
    "binding": "ASSETS",
    "not_found_handling": "single-page-application",
    "run_worker_first": ["/api/*", "/mascota/*"]
  },
  "d1_databases": [
    { "binding": "DB", "database_name": "patiamor-db", "database_id": "<prod id>", "migrations_dir": "migrations" }
  ],
  "routes": [{ "pattern": "patiamor.com", "custom_domain": true }],
  "env": {
    "staging": {
      // Bindings and routes are NOT inherited by environments; repeat them here.
      "d1_databases": [
        { "binding": "DB", "database_name": "patiamor-db-staging", "database_id": "<staging id>", "migrations_dir": "migrations" }
      ],
      "routes": [],
      "workers_dev": true
    }
  }
}
```

`api/src/index.ts`, minimal shape:

```ts
import { Hono } from 'hono';

type Env = { DB: D1Database; ASSETS: Fetcher };
const app = new Hono<{ Bindings: Env }>();

app.get('/api/health', async (c) => {
  const row = await c.env.DB.prepare('SELECT 1 AS ok').first();
  return c.json({ ok: row?.ok === 1 });
});

// Anything that isn't /api/* is served from static assets before the Worker runs.
export default app;
```

## 3. Create the databases

Status (2026-10-12): `patiamor-db-staging` exists (ENAM region), is migrated and seeded, and its ID is in `wrangler.jsonc`. `patiamor-db` (production) has **not** been created; that needs the owner's approval. Until it exists, `deploy-prod.yml` fails at the migration step, which is harmless.

```bash
cf d1 create patiamor-db-staging                 # free: staging
CF_APPROVED=1 cf d1 create patiamor-db           # production: ask first
```

Copy each `database_id` into `wrangler.jsonc`. IDs aren't secrets and are committed. Then apply migrations in the usual order (see `d1.md`).

## 4. First deploys

1. `cd web && npm run build`
2. `cf deploy --env staging`, then smoke-test the workers.dev URL.
3. Production with approval, once `patiamor.com` is registered and in the token's zone list. The `custom_domain` route creates the DNS record automatically on deploy, which counts as a DNS change, so mention it when asking.

## 5. GitHub Actions secrets (owner)

This setup relies on GitHub environments, which a repo on GitHub Free only gets while it's public.

- **Repository secret** (Settings → Secrets and variables → Actions): `CLOUDFLARE_ACCOUNT_ID`.
- **Environment `staging`** (Settings → Environments):
  - deployment branches limited to `main`;
  - secrets: `CLOUDFLARE_API_TOKEN` (a dedicated staging CI token) and `STAGING_ADMIN_EMAILS` (comma-separated).
- **Environment `production`:**
  - deployment branches limited to `prod`;
  - required reviewer: the owner;
  - secret: `CLOUDFLARE_API_TOKEN` (a dedicated production CI token).

Each CI token has the same permissions as the local token in step 1. Cloudflare can't scope a token to a single Worker or database, so the separation is about revoking each independently and gating access, not true isolation.

## 6. Mobile app (later)

The Capacitor-wrapped app calls `https://patiamor.com/api`. Its origin (`capacitor://localhost`, or `https://localhost` on Android) needs a CORS allowance on `/api/*`. Use Hono's `cors()` with an explicit allowlist, never `*` on authenticated routes.
