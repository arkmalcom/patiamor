import { html, raw, type Raw } from '../dom';
import { t, type Key } from '../i18n';

/** Links to the privacy policy and the terms. In a sheet they open in a new tab, so a form half-filled isn't lost. */
export function legalLinks(lead: Key | null = null, newTab = false): Raw {
  const open = newTab ? raw(' target="_blank" rel="noopener"') : '';
  return html`<p class="legal-links">${lead ? `${t(lead)} ` : ''}<a href="/terminos"${open}>${t('legal.terminos')}</a> · <a href="/privacidad"${open}>${t('legal.privacidad')}</a></p>`;
}
