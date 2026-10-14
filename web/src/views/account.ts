import { Globe, House, LogOut } from 'lucide';
import { api } from '../api';
import { html, icon, mount } from '../dom';
import { t } from '../i18n';
import { setUser, state } from '../store';
import { renderAuth } from '../ui/auth';
import { toast } from '../ui/toast';

export function renderAccount(root: HTMLElement) {
  const user = state.user;
  mount(
    root,
    html`
      <section class="account" aria-labelledby="account-title">
        <h1 class="page-title" id="account-title" tabindex="-1" data-focus>${t('account.title')}</h1>
        <div class="account__block">
          ${user
            ? html`
                ${user.name ? html`<p class="account__hello">${t('auth.welcome', { name: user.name })}</p>` : ''}
                <p class="muted">${t('account.signedInAs', { email: user.email })}</p>
                <button class="button button--outline" type="button" data-signout>${icon(LogOut, 18)}${t('account.signOut')}</button>`
            : html`<p>${t('account.signedOut')}</p><div class="account__auth" data-auth></div>`}
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
            ${user?.shelters?.length
              ? html`<p class="account__shelters">${user.shelters.map((sh) => html`<span>${sh.name} · ${t(`portal.status.${(sh.status ?? 'pending') as 'pending'}`)}</span>`)}</p>`
              : ''}
            <a class="button button--ink" href="/refugio">${user?.shelters?.length ? t('account.shelterPortal') : t('account.shelterCta')}</a>
          </div>
        </div>
        <p class="sample-note">${t('app.sampleNote')}</p>
      </section>`,
  );
  const authRoot = root.querySelector<HTMLElement>('[data-auth]');
  if (authRoot) renderAuth(authRoot, { next: '/cuenta', onSignedIn: (u) => toast(t('auth.signedIn', { who: u.name ?? u.email })) });
  root.querySelector('[data-signout]')?.addEventListener('click', async () => {
    try {
      await api.logout();
    } catch {
      toast(t('auth.err.network'));
      return;
    }
    setUser(null);
  });
}
