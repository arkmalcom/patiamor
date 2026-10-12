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
1. Loads `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` from the gitignored root `.env`.
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
.env                    CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID (gitignored)
api/.dev.vars           Local-only secrets for `wrangler dev` (gitignored)
backups/                D1 exports taken before production migrations (gitignored)
```

| | Production | Staging |
|---|---|---|
| Worker | `patiamor` | `patiamor-staging` |
| D1 database | `patiamor-db` | `patiamor-db-staging` |
| URL | patiamor.com | `patiamor-staging.<account>.workers.dev` |

If `api/` doesn't exist yet, scaffold it from `references/setup.md` before anything else. Read `api/wrangler.jsonc` before any remote work: the IDs and names in it are authoritative, and this table is only the plan.

## Everyday workflows

**Local development**
1. Build the frontend once with `cd web && npm run build`.
2. Run `cf dev` from `api/`. It serves the API and `web/dist` with a local D1.
3. Apply migrations locally first with `cf d1 migrations apply patiamor-db --local`.

For frontend work, `npm run dev` in `web/` with a Vite proxy to the Worker is faster.

**Change the schema.** Read `references/d1.md` first. The flow is always local, then staging, then (with approval) production:
1. `cf d1 migrations create patiamor-db <description>`, then write the SQL.
2. Apply `--local` and run the app or tests.
3. Apply with `--env staging --remote`, then verify on staging.
4. Ask before production: back up with `d1 export`, apply with `--remote`, then verify.

Never edit a migration that has already been applied to staging or production; write a new one.

**Deploy to staging** (free): build `web/`, run `cf deploy --env staging`, then smoke-test the staging URL with `curl` (`/api/health` and one real endpoint). Watch errors with `cf tail --env staging`.

**Deploy to production** (ask first): use this checklist, and state each step to the owner:
1. Staging runs the same commit and passes the smoke test.
2. Any pending migrations are applied to production first, after a backup.
3. Run `cf versions list` to note the current version ID for rollback.
4. `CF_APPROVED=1 cf deploy`.
5. Smoke-test patiamor.com, and watch `cf tail` for a minute.

**Rollback** (ask first): `cf rollback <version-id>` reverts code only. Data changes are undone with a new migration, or with D1 Time Travel as a last resort (`references/d1.md`).

**Secrets** (ask first): `cf secret put NAME --env staging`, then the owner pastes the value. Keep local values in `api/.dev.vars`, never in `wrangler.jsonc` `vars`, because `vars` is committed config.

**Logs**: `cf tail --env staging --format pretty` streams live requests. Production tail is read-only, so it's allowed.

## When you're unsure

Wrangler and Cloudflare change quickly, and your memory of flags may be stale. Check before guessing:
- `cf <command> --help` shows the current flags for the pinned version.
- Cloudflare's docs are at https://developers.cloudflare.com. Product docs also have an `llms.txt`, e.g. https://developers.cloudflare.com/d1/llms.txt.
- When you learn a durable fact about this project's setup, update this skill so the next session knows it. Examples: a database ID, a quirk, a changed command.
