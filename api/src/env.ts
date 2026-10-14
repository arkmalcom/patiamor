export type Env = {
  DB: D1Database;
  /** Pet photos (R2). Keys are chosen by the Worker, never by the client: pets/<petId>/<content hash>[-t].<ext>. */
  PHOTOS: R2Bucket;
  /** Writes per account (or IP) per minute. Optional so a missing binding never takes the API down. */
  WRITE_LIMIT?: RateLimit;
  ASSETS: Fetcher;
  /** 'production' | 'staging' | 'development'. Set in wrangler.jsonc vars; .dev.vars overrides locally. */
  ENVIRONMENT: string;
  /** Where the web app lives, for redirects after sign-in. Defaults to the request's origin. */
  APP_ORIGIN?: string;
  EMAIL_FROM: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  /** Without it, non-production environments log sign-in codes instead of emailing them. */
  RESEND_API_KEY?: string;
  /** Turnstile widget's public site key (wrangler vars). Unset: no bot check on email sign-in. */
  TURNSTILE_SITE_KEY?: string;
  /** Turnstile widget's secret key (a secret). Required once TURNSTILE_SITE_KEY is set. */
  TURNSTILE_SECRET?: string;
  /** Sentry project DSN (a secret, so the public repo can't be used to flood the quota). Unset locally: no reporting. */
  SENTRY_DSN?: string;
};

export type AppUser = {
  id: string;
  email: string;
  name: string | null;
  is_admin: number;
  /** When an admin approved them as a shelter owner (admins don't need it). */
  shelter_owner_at: string | null;
};

export type AppContext = { Bindings: Env; Variables: { user: AppUser | null } };
