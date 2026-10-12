import { Globe, House, LogOut } from 'lucide';
import { CONTACT_EMAIL } from '../data';
import { html, icon, mount } from '../dom';
import { t } from '../i18n';
import { state, update } from '../store';

export function renderAccount(root: HTMLElement) {
  const subject = encodeURIComponent('Quiero publicar perros de mi refugio');
  mount(
    root,
    html`
      <section class="account" aria-labelledby="account-title">
        <h1 class="page-title" id="account-title" tabindex="-1" data-focus>${t('account.title')}</h1>
        <div class="account__block">
          <p>${state.signedIn ? t('account.signedIn') : t('account.signedOut')}</p>
          ${state.signedIn
            ? html`<button class="button button--outline" type="button" data-signout>${icon(LogOut, 18)}${t('account.signOut')}</button>`
            : html`<div class="auth__buttons">
                <button class="button button--outline button--block" type="button" data-signin>${t('auth.google')}</button>
                <button class="button button--outline button--block" type="button" data-signin>${t('auth.email')}</button>
              </div>
              <p class="sample-note">${t('auth.demo')}</p>`}
        </div>
        <div class="account__row">
          ${icon(Globe, 20)}
          <span><strong>${t('account.language')}</strong><br /><span class="muted">${t('account.languageValue')}</span></span>
        </div>
        <div class="account__shelter" data-frame="anil">
          <span class="shelter__mark" aria-hidden="true">${icon(House, 22)}</span>
          <div>
            <h2 class="account__shelter-title">${t('account.shelterTitle')}</h2>
            <p>${t('account.shelterBody')}</p>
            <a class="button button--ink" href="mailto:${CONTACT_EMAIL}?subject=${subject}">${t('account.shelterCta')}</a>
          </div>
        </div>
        <p class="sample-note">${t('app.sampleNote')}</p>
      </section>`,
  );
  root.querySelector('[data-signout]')?.addEventListener('click', () => update((s) => (s.signedIn = false)));
  root.querySelectorAll('[data-signin]').forEach((b) => b.addEventListener('click', () => update((s) => (s.signedIn = true))));
}
