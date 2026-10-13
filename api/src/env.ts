export type Env = {
  DB: D1Database;
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
  /** Sentry project DSN (a secret, so the public repo can't be used to flood the quota). Unset locally: no reporting. */
  SENTRY_DSN?: string;
};

export type AppUser = {
  id: string;
  email: string;
  name: string | null;
  is_admin: number;
};

export type AppContext = { Bindings: Env; Variables: { user: AppUser | null } };
