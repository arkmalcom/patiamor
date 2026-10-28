import { html, type Raw } from '../dom';
import { t } from '../i18n';

/** The Rescate tab's two sections: help cases (/ayudar) and lost and found (/perdidos). */
export const rescueTabs = (current: 'help' | 'lost'): Raw => html`
  <nav class="list-tabs rescue-tabs" aria-label="${t('rescue.tabs')}">
    <a class="list-tabs__tab" href="/ayudar" aria-current="${current === 'help' ? 'page' : 'false'}">${t('rescue.tab.help')}</a>
    <a class="list-tabs__tab" href="/perdidos" aria-current="${current === 'lost' ? 'page' : 'false'}">${t('rescue.tab.lost')}</a>
  </nav>`;
