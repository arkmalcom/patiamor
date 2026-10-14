import { api, ApiError } from '../api';

// Turnstile, Cloudflare's free bot check, in front of email sign-in. Invisible for almost everyone: it
// shows a checkbox only when Cloudflare isn't sure. The script loads only on the sign-in screen, and
// only when the server has a site key.

interface Turnstile {
  render(el: HTMLElement, opts: Record<string, unknown>): string | undefined;
  reset(id: string): void;
  remove(id: string): void;
}

declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}

/** Long enough for someone who has to tick the checkbox. */
const WAIT_MS = 60_000;
let script: Promise<Turnstile> | undefined;

function load(): Promise<Turnstile> {
  script ??= new Promise<Turnstile>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new ApiError('human_check', {})));
    s.onerror = () => {
      script = undefined; // a later sign-in screen tries again
      s.remove();
      reject(new ApiError('human_check', {}));
    };
    document.head.append(s);
  });
  return script;
}

export interface HumanCheck {
  /** A fresh single-use token, or undefined when the check is off. Throws ApiError('human_check'). */
  token(): Promise<string | undefined>;
  remove(): void;
}

/** Starts the check in `el` right away, so a token is usually ready by the time the email is typed. */
export function humanCheck(el: HTMLElement): HumanCheck {
  let ts: Turnstile | undefined;
  let id: string | undefined;
  let ready: string | undefined;
  let waiting: ((t: string | undefined) => void) | undefined;
  const settle = (t: string | undefined) => {
    if (waiting) waiting(t);
    else ready = t;
    waiting = undefined;
  };

  const setup = api.authConfig().then(async ({ turnstile: sitekey }) => {
    if (!sitekey) return false;
    ts = await load();
    id = ts.render(el, {
      sitekey,
      action: 'signin',
      appearance: 'interaction-only',
      language: 'es',
      size: 'flexible',
      'refresh-expired': 'auto',
      callback: settle,
      'expired-callback': () => (ready = undefined),
      'error-callback': () => settle(undefined),
    });
    return true;
  });
  setup.catch(() => {}); // reported when a token is asked for

  return {
    async token() {
      if (!(await setup)) return undefined;
      const t =
        ready ??
        (await new Promise<string | undefined>((resolve) => {
          const timer = setTimeout(() => waiting === done && settle(undefined), WAIT_MS);
          const done = (v: string | undefined) => (clearTimeout(timer), resolve(v));
          waiting = done;
        }));
      ready = undefined;
      // Tokens are single-use: start on the next one now, for "Reenviar código".
      if (id) ts?.reset(id);
      if (!t) throw new ApiError('human_check', {});
      return t;
    },
    remove() {
      if (id) ts?.remove(id);
    },
  };
}
