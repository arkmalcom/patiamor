# Changing the name or the domain

Patiamor's name and public contact address live in one file, so a rename is mostly a short list of edits plus setting up outside services on the new domain. Do it before production setup if you can. Afterwards it means redoing that setup, and links already shared on WhatsApp or sent by email stop working, unless the old domain is kept to redirect them (which keeps its yearly fee).

## 1. In the code (one commit)

| What | Where |
|---|---|
| Name, contact email, tagline, description | `web/src/brand.ts`. Everything visible reads from it: app text (`{app}` and `{contact}` in `web/src/i18n.ts`), the page title and link previews (`web/index.html`, filled in by `web/vite.config.ts`), the install manifest (built by the same file), emails (`api/src/auth/email.ts`) and pet link previews (`api/src/share.ts`). |
| Production address and email sender | `api/wrangler.jsonc`, top-level `vars`: `APP_ORIGIN` and `EMAIL_FROM`. The sender's domain must be the one verified in Resend. |
| Staging email sender | `api/wrangler.jsonc`, `env.staging.vars.EMAIL_FROM`. |
| Production URL for the deploy and its smoke test | `.github/workflows/deploy-prod.yml`: `environment.url` and `PROD_URL`. |
| Legal texts | Nothing to edit: the pages at `/privacidad` and `/terminos` show `docs/legal/*.md` with the name, contact email and the address the site runs on filled in from `brand.ts` (`fill()` in `web/src/legal-md.ts`). A test fails if a text names anything a rename wouldn't change. |
| Logo, if it changes | `web/public/favicon.svg`. The PNG icons in `web/public/icons/` are made from it on the app's pale blue (`rsvg-convert` plus `magick`; the commands are in the commit that added them, e74b5b3). The wordmark in the top bar is text, so it follows the name. |

`api/test/brand.test.ts` fails if any app text spells the name or email out instead of using `{app}` and `{contact}`. After the edits, run `npm test` in `api/` and `npm run build` in `web/`, and search the visible text for the old name.

## 2. Outside services (the owner, on the new domain)

- **Domain:** register it (Cloudflare Registrar, a yearly fee) and add it as a zone in the same Cloudflare account.
- **Production Worker:** attach the domain as its custom domain, and give the production CI token permissions on the new zone.
- **Email sending (Resend):** add and verify the domain, add its DNS records (DKIM, the `send` MX and SPF, DMARC), and create a sending key for it. Then set it as `RESEND_API_KEY`.
- **Contact address:** Cloudflare Email Routing on the new zone, so the new contact address reaches you.
- **Turnstile:** a widget whose hostname is the new domain. Set its secret as `TURNSTILE_SECRET` and its site key in the production vars.
- **Google sign-in:**
  - the app's name;
  - the authorised domain;
  - the redirect `https://<domain>/api/auth/google/callback`;
  - the privacy and terms links;
  - domain verification in Search Console.
- **Rate-limit rule (PAT-30):** it belongs to a zone, so create it again on the new one.

## 3. Kept on purpose

These say "patiamor" but nobody using the app sees them. Renaming them costs more than it's worth:

- **The session cookie** `__Host-patiamor_session`. Renaming it signs everyone out.
- **Browser storage keys** (`patiamor`, `patiamor-session`, `patiamor-pending-request`). Renaming them forgets people's filters and drafts.
- **Cloudflare resource names:** the Worker (`patiamor`, `patiamor-staging`), the databases (`patiamor-db`, `patiamor-db-staging`) and the photo buckets. Renaming a Worker changes its `workers.dev` address. For staging, that also means a new Turnstile hostname and new staging URLs in `.github/workflows/deploy-staging.yml`. Databases and buckets can't be renamed; they'd have to be copied.
- **Code comments, `PRODUCT.md`, the skills, ticket keys (`PAT-…`) and the repository name.**
