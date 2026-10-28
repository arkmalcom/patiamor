import { HandHeart } from 'lucide';
import { html, icon, type Raw } from '../dom';
import { t } from '../i18n';

/** "¿No estás buscando adoptar ahora? Igual puedes ayudar.": a way into the help cases from the adoption side. */
export const helpInvite = (): Raw => html`<p class="help-invite">${icon(HandHeart, 18)}<span>${t('help.invite')} <a href="/ayudar">${t('help.inviteLink')}</a></span></p>`;
