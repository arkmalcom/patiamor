---
name: cloudflare
description: Operate Patiamor's Cloudflare platform. Covers the TypeScript Worker that serves the API and the web app, the D1 database (schema, migrations, queries, backups), wrangler, staging and production deploys, secrets, logs, and the patiamor.com domain. Use this whenever a task touches Cloudflare, wrangler, Workers, D1, the database schema or data, deploying or "shipping", environment variables or secrets, staging or production, live errors and logs, or DNS and the domain. Use it even when Cloudflare isn't named, e.g. "add a column for microchip number", "push this to staging", "why is the API 500ing", "seed some test dogs".
---

# Cloudflare for Patiamor

Patiamor runs on Cloudflare: one **TypeScript Worker** serves the JSON API under `/api/*` and the built web app (`web/dist`) as static assets. Data lives in **D1** (SQLite). The domain **patiamor.com** is registered through Cloudflare Registrar. Product context is in `PRODUCT.md` at the repo root.

The owner gave a clear permission policy, enforced in two layers:
- this document, which tells you when to ask;
- `scripts/cf`, which refuses risky commands unless approval was given.

Both exist so a slip can't take down production or lose real shelters' data.

## Branches and environments

| Git branch | Environment | Worker | D1 database | URL |
|---|---|---|---|---|
| `main` | staging | `patiamor-staging` | `patiamor-db-staging` (seeded with sample data) | https://patiamor-staging.patiamor-api.workers.dev |
| `prod` | production | `patiamor` | `patiamor-db` (real data only) | https://patiamor.com |

Work happens on feature branches, which open PRs into `main`. GitHub Actions (`.github/workflows/`) do the deploys:
- **`ci.yml`** runs on every PR into `main` or `prod`. It builds, type-checks, dry-runs the Worker bundle, and refuses edits to existing migrations. It needs no secrets.
- **`deploy-staging.yml`** runs on every push to `main`. It applies migrations, re-applies `api/seeds/staging.sql` (idempotent), deploys `--env staging`, and smoke-tests.
- **`deploy-prod.yml`** runs on every push to `prod`. It records a D1 Time Travel bookmark, applies migrations, deploys, and smoke-tests.

**Merging or pushing to `prod` is a production deploy**, so the permission policy applies to it like any other production action. Open the `main` → `prod` PR when asked, but never merge it or push to `prod` without the owner's explicit yes. The `production` GitHub environment also requires the owner's approval for each run, but don't rely on that alone: this rule applies either way. Pushing to `main` deploys staging, which is free under the policy, but still only commit or push when the owner asks.

Seeds (`api/seeds/*.sql`) are staging-only sample data and never run in production. Reference data that production needs too, such as `places`, ships as a migration instead.

## The permission policy

| You may do freely | Ask the owner first, every time |
|---|---|
| Anything local: `wrangler dev`, local D1 (`--local`), builds, tests | Any deploy, migration, or write to **production** |
| Read-only checks anywhere: `whoami`, `d1 list/info`, `SELECT` queries, `migrations list`, `tail`, `d1 export` backups | **Deleting** anything (Workers, databases, rows with `DELETE`/`DROP`/`TRUNCATE`), on staging too |
| Deploy to **staging** (`--env staging`) | Setting or removing **secrets**, in any environment |
| Apply migrations and write test data on **staging** | **DNS**, routes, custom domains, the registrar, and the API token or its permissions |
| Create staging resources (names ending in `-staging`) | Creating production resources, D1 time-travel restores, rollbacks |

How to ask: show the exact command, say what it changes, and say how you'd undo it (backup taken, previous version ID, Time Travel timestamp). Wait for a clear yes for that specific action. A yes covers that one command, not similar ones later.

Never purchase, renew, or transfer domains or plans. Point the owner to the dashboard instead.

## Always run wrangler through `scripts/cf`

```bash
.claude/skills/cloudflare/scripts/cf <wrangler args>              # normal use
.claude/skills/cloudflare/scripts/cf --check <wrangler args>      # classify only, runs nothing
CF_APPROVED=1 .claude/skills/cloudflare/scripts/cf <wrangler args> # only after the owner said yes
```

The wrapper does three things:
1. Loads `PATIAMOR_CLOUDFLARE_API_TOKEN` and `PATIAMOR_CLOUDFLARE_ACCOUNT_ID` from the gitignored root `.env`, and hands them to wrangler under the names it expects. The same file also holds R2's S3-style credentials (`PATIAMOR_CLOUDFLARE_ACCESS_KEY_ID`, `_SECRET_ACCESS_KEY`, `_S3_API_ENDPOINT`), which only S3 clients use; the Worker reaches R2 through a binding instead.
2. Uses the wrangler version pinned in `api/`.
3. Exits with code 3 and the word `BLOCKED` when a command needs approval.

A block isn't an error to work around. It means stop and ask. Never set `CF_APPROVED=1` on your own judgement, and never call `npx wrangler` directly to bypass the wrapper.

Never print, echo, or commit the token. If `.env` is missing or the token is rejected, stop and point the owner to `references/setup.md`. Only the owner creates tokens.

**No `--env` means production.** The top-level wrangler config is production, and staging is always `--env staging`. Make `--env staging` your reflex on every remote command.

## Where things live

```
api/                    Worker (TypeScript, Hono)
  wrangler.jsonc        Source of truth for names, bindings, environments
  src/index.ts          Entry: /api/* routes, everything else served from ASSETS
  migrations/           D1 migrations, NNNN_description.sql, applied in order
web/                    Vite frontend; `npm run build` → web/dist (served by the Worker)
.env                    PATIAMOR_CLOUDFLARE_* credentials (gitignored)
api/.dev.vars           Local-only secrets for `wrangler dev` (gitignored)
backups/                D1 exports taken before production migrations (gitignored)
```

Read `api/wrangler.jsonc` before any remote work: the IDs and names in it are authoritative. In every `d1` command, refer to the database by its binding, **`DB`**. It resolves to the right database for whichever `--env` is used.

Without a `RESEND_API_KEY` secret, staging logs sign-in codes instead of emailing them. To test sign-in on staging, run `cf tail --env staging` and read the `[dev email]` line.

## Everyday workflows

**Local development**
1. Build the frontend once with `cd web && npm run build`.
2. Run `cf dev` from `api/`. It serves the API and `web/dist` with a local D1.
3. Apply migrations locally first with `cf d1 migrations apply DB --local`.

For frontend work, `npm run dev` in `web/` with a Vite proxy to the Worker is faster.

**Change the schema.** Read `references/d1.md` first. The flow is always local, then staging, then (with approval) production:
1. `cf d1 migrations create DB <description>`, then write the SQL.
2. Apply `--local` and run the app or tests.
3. Apply with `--env staging --remote`, then verify on staging.
4. Ask before production: back up with `d1 export`, apply with `--remote`, then verify.

Never edit a migration that has already been applied to staging or production; write a new one.

**Deploy to staging**: normally a merge into `main` does it through CI. A manual `cf deploy --env staging` is fine for a quick check, but CI will overwrite it on the next push. Smoke-test the staging URL and watch errors with `cf tail --env staging`.

**Deploy to production** (ask first): normally through the `main` → `prod` PR. Before asking the owner to merge it:
1. Confirm staging runs the same commit and passes the smoke test.
2. List the migrations it will apply (`cf d1 migrations list DB --remote`, a read-only check).
3. Note the current version ID for rollback (`cf versions list`).

A manual `CF_APPROVED=1 cf deploy` is only for emergencies, and only with an explicit yes.

**Rollback** (ask first): `cf rollback <version-id>` reverts code only. Data changes are undone with a new migration, or with D1 Time Travel as a last resort (`references/d1.md`).

**Secrets** (ask first): `cf secret put NAME --env staging`, then the owner pastes the value. Keep local values in `api/.dev.vars`, never in `wrangler.jsonc` `vars`, because `vars` is committed config.

**Logs**: `cf tail --env staging --format pretty` streams live requests. Production tail is read-only, so it's allowed.

**Tests** (free, local): `npm test` in `api/` runs the Vitest suite inside the Workers runtime (`@cloudflare/vitest-plugin`) against a local D1 with every migration applied (`vitest.config.ts`, `test/setup.ts`). Helpers in `test/helpers.ts` sign users in with a real session row and call the Worker like the app does. CI runs them on every pull request. Write a test for every permission rule: who can read or change what is where bugs cost the most.

## When you're unsure

Wrangler and Cloudflare change quickly, and your memory of flags may be stale. Check before guessing:
- `cf <command> --help` shows the current flags for the pinned version.
- Cloudflare's docs are at https://developers.cloudflare.com. Product docs also have an `llms.txt`, e.g. https://developers.cloudflare.com/d1/llms.txt.
- When you learn a durable fact about this project's setup, update this skill so the next session knows it. Examples: a database ID, a quirk, a changed command.
