import { Mail } from 'lucide';
import { api, ApiError, type Me } from '../api';
import { $, html, icon, mount, raw } from '../dom';
import { t, type Key } from '../i18n';
import { setUser } from '../store';
import { humanCheck } from './human';
import { legalLinks } from './legal-links';

// Sign-in: Google, or one email carrying a 6-digit code plus a one-tap link. Then the name, if we lack it.

interface AuthOpts {
  /** In-app route to come back to after a Google or email-link redirect. */
  next: string;
  /** Called before leaving the page for Google, so in-progress work can be stashed. */
  beforeRedirect?: () => void;
  onSignedIn: (user: Me) => void;
}

const RESEND_SECONDS = 45;

// Google's standard multicolor "G", unmodified, as their sign-in branding guidelines require.
const GOOGLE_G = raw(`<svg class="google-g" viewBox="0 0 48 48" width="20" height="20" aria-hidden="true" focusable="false">
  <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
  <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
  <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
  <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
</svg>`);

export function errorText(code: string, data: Record<string, unknown> = {}): string {
  const key = `auth.err.${code}` as Key;
  try {
    return t(key, { n: String(data.attemptsLeft ?? '') });
  } catch {
    return t('auth.err.network');
  }
}

export function renderAuth(root: HTMLElement, opts: AuthOpts) {
  let email = '';
  let timer = 0;
  // Steps swap inside `step`; the bot check sits below them and survives the swaps (moving its iframe would reload it).
  mount(root, html`<div data-step></div><div class="auth__check" data-check></div>`);
  const step = $('[data-step]', root);
  const check = humanCheck($('[data-check]', root));

  const showError = (el: HTMLElement, err: unknown) => {
    el.textContent = err instanceof ApiError ? errorText(err.code, err.data) : t('auth.err.network');
    el.hidden = false;
  };

  const stepEmail = () => {
    mount(
      step,
      html`
        <div class="auth">
          <a class="button button--outline button--block button--google" href="${api.googleUrl(opts.next)}" data-google>${GOOGLE_G}<span>${t('auth.google')}</span></a>
          <p class="auth__or"><span>${t('auth.or')}</span></p>
          <form class="auth__form" data-email-form novalidate>
            <label class="field">
              <span class="field__label">${t('auth.emailLabel')}</span>
              <input class="field__input" type="email" name="email" autocomplete="email" inputmode="email" required
                placeholder="${t('auth.emailPlaceholder')}" value="${email}" />
            </label>
            <p class="field__error" role="alert" hidden data-error></p>
            <button class="button button--ink button--block" type="submit">${icon(Mail, 18)}<span>${t('auth.sendCode')}</span></button>
          </form>
          <p class="sample-note">${t('auth.privacy')}</p>
          ${legalLinks('legal.signIn', true)}
        </div>`,
    );
    $('[data-google]', root).addEventListener('click', () => opts.beforeRedirect?.());
    const form = $<HTMLFormElement>('[data-email-form]', root);
    const input = $<HTMLInputElement>('input', form);
    const err = $('[data-error]', form);
    const btn = $<HTMLButtonElement>('button[type=submit]', form);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      email = input.value.trim();
      err.hidden = true;
      btn.disabled = true;
      $('span', btn).textContent = t('auth.sending');
      try {
        opts.beforeRedirect?.(); // the email link may be opened later, in this tab
        await api.startEmail(email, opts.next, await check.token());
        stepCode();
      } catch (e2) {
        showError(err, e2);
        btn.disabled = false;
        $('span', btn).textContent = t('auth.sendCode');
      }
    });
  };

  const stepCode = () => {
    mount(
      step,
      html`
        <form class="auth auth__form" data-code-form novalidate>
          <p>${t('auth.codeSent', { email })}</p>
          <label class="field">
            <span class="field__label">${t('auth.codeLabel')}</span>
            <input class="field__input field__input--code" name="code" autocomplete="one-time-code" inputmode="numeric"
              pattern="[0-9]{6}" maxlength="6" required />
          </label>
          <p class="field__error" role="alert" hidden data-error></p>
          <button class="button button--primary button--block" type="submit"><span>${t('auth.verify')}</span></button>
          <div class="auth__links">
            <button class="text-button" type="button" data-other>${t('auth.otherEmail')}</button>
            <button class="text-button" type="button" data-resend disabled></button>
          </div>
        </form>`,
    );
    const form = $<HTMLFormElement>('[data-code-form]', root);
    const input = $<HTMLInputElement>('input', form);
    const err = $('[data-error]', form);
    const btn = $<HTMLButtonElement>('button[type=submit]', form);
    const resend = $<HTMLButtonElement>('[data-resend]', form);
    input.focus();

    let left = RESEND_SECONDS;
    const tick = () => {
      resend.disabled = left > 0;
      resend.textContent = left > 0 ? t('auth.resendIn', { s: left }) : t('auth.resend');
      left--;
    };
    clearInterval(timer);
    tick();
    timer = window.setInterval(() => (left >= 0 ? tick() : clearInterval(timer)), 1000);

    input.addEventListener('input', () => {
      input.value = input.value.replace(/\D/g, '').slice(0, 6);
      if (input.value.length === 6) form.requestSubmit();
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      err.hidden = true;
      btn.disabled = true;
      $('span', btn).textContent = t('auth.verifying');
      try {
        const user = await api.verifyEmail(email, input.value);
        clearInterval(timer);
        finish(user);
      } catch (e2) {
        showError(err, e2);
        btn.disabled = false;
        $('span', btn).textContent = t('auth.verify');
        input.select();
      }
    });
    $('[data-other]', form).addEventListener('click', () => (clearInterval(timer), stepEmail()));
    resend.addEventListener('click', async () => {
      try {
        await api.startEmail(email, opts.next, await check.token());
        stepCode();
      } catch (e2) {
        showError(err, e2);
      }
    });
  };

  const finish = (user: Me) => {
    check.remove();
    if (user.name) {
      setUser(user);
      return opts.onSignedIn(user);
    }
    stepName(user);
  };

  const stepName = (user: Me) => {
    mount(
      step,
      html`
        <form class="auth auth__form" data-name-form novalidate>
          <h3 class="auth__title">${t('auth.nameTitle')}</h3>
          <p class="muted">${t('auth.nameBody')}</p>
          <label class="field">
            <span class="field__label">${t('auth.nameLabel')}</span>
            <input class="field__input" name="name" autocomplete="name" required minlength="2" maxlength="80" />
          </label>
          <p class="field__error" role="alert" hidden data-error></p>
          <button class="button button--primary button--block" type="submit"><span>${t('auth.nameSave')}</span></button>
        </form>`,
    );
    const form = $<HTMLFormElement>('[data-name-form]', root);
    const input = $<HTMLInputElement>('input', form);
    const err = $('[data-error]', form);
    input.focus();
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const named = await api.setName(input.value);
        setUser({ ...user, ...named });
        opts.onSignedIn({ ...user, ...named });
      } catch (e2) {
        showError(err, e2);
      }
    });
  };

  stepEmail();
}
