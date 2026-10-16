import legal from 'virtual:legal';
import { ArrowLeft } from 'lucide';
import { BRAND } from '../brand';
import { $, html, icon, mount, raw } from '../dom';
import { t } from '../i18n';
import { fill, inline, parseMarkdown, type Block } from '../legal-md';

// The privacy policy (/privacidad) and the terms (/terminos): the Markdown in docs/legal/, shown as a page.

export type LegalDoc = 'privacidad' | 'terminos';

const block = (b: Block) =>
  b.type === 'ul' ? html`<ul>${b.items.map((i) => html`<li>${raw(inline(i))}</li>`)}</ul>` : b.type === 'h2' ? html`<h2>${raw(inline(b.text))}</h2>` : b.type === 'h1' ? html`` : html`<p>${raw(inline(b.text))}</p>`;

export function renderLegal(root: HTMLElement, doc: LegalDoc) {
  const blocks = parseMarkdown(fill(legal[doc], { name: BRAND.name, contactEmail: BRAND.contactEmail, host: location.host }));
  const heading = blocks.find((b) => b.type === 'h1');
  const title = heading && heading.type !== 'ul' ? heading.text : t(`legal.${doc}`);
  mount(
    root,
    html`
      <article class="legal" aria-labelledby="legal-title">
        <button class="text-button legal__back" type="button" data-back>${icon(ArrowLeft, 18)}${t('legal.back')}</button>
        <h1 class="page-title" id="legal-title" tabindex="-1" data-focus>${title}</h1>
        <div class="legal__text">
          ${blocks.map(block)}
          <p class="legal__other"><a href="${doc === 'privacidad' ? '/terminos' : '/privacidad'}">${t(doc === 'privacidad' ? 'legal.terminos' : 'legal.privacidad')}</a></p>
        </div>
      </article>`,
  );
  $('[data-back]', root).addEventListener('click', () => (history.length > 1 && document.referrer.startsWith(location.origin) ? history.back() : location.assign('/')));
}
