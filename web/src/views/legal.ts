import legal from 'virtual:legal';
import { ArrowLeft } from 'lucide';
import { BRAND } from '../brand';
import { $, html, icon, mount, raw } from '../dom';
import { setPage } from '../seo';
import { fill, inline, parseMarkdown, type Block } from '../legal-md';

// The privacy policy and the terms (/privacidad, /terminos, and in English /en/privacy, /en/terms): the
// Markdown in docs/legal/, shown as a page. The English ones are a translation; the Spanish is the original.

export type LegalDoc = 'privacidad' | 'terminos' | 'privacy' | 'terms';

/** The page's own words, in the language of the text (the rest of the app is Spanish only). */
const WORDS = {
  es: { lang: 'es-DO', back: 'Volver', privacy: 'Política de privacidad', terms: 'Términos de uso', other: 'Read this in English', about: { privacy: 'Qué datos tuyos guarda {app}, para qué, con quién los comparte y cómo pedir que los borremos.', terms: 'Las reglas para usar {app}: adoptar, publicar animales y lo que nadie puede hacer.' }, paths: { privacy: '/privacidad', terms: '/terminos', otherPrivacy: '/en/privacy', otherTerms: '/en/terms' } },
  en: { lang: 'en', back: 'Back', privacy: 'Privacy Policy', terms: 'Terms of Use', other: 'Leer en español', about: { privacy: 'What personal data {app} keeps, why, who it is shared with and how to ask for it to be deleted.', terms: 'The rules for using {app}: adopting, listing animals and what nobody may do.' }, paths: { privacy: '/en/privacy', terms: '/en/terms', otherPrivacy: '/privacidad', otherTerms: '/terminos' } },
} as const;

const block = (b: Block) =>
  b.type === 'ul' ? html`<ul>${b.items.map((i) => html`<li>${raw(inline(i))}</li>`)}</ul>` : b.type === 'h2' ? html`<h2>${raw(inline(b.text))}</h2>` : b.type === 'h1' ? html`` : html`<p>${raw(inline(b.text))}</p>`;

export function renderLegal(root: HTMLElement, doc: LegalDoc) {
  const w = WORDS[doc === 'privacy' || doc === 'terms' ? 'en' : 'es'];
  const policy = doc === 'privacidad' || doc === 'privacy';
  const blocks = parseMarkdown(fill(legal[doc], { name: BRAND.name, contactEmail: BRAND.contactEmail, host: location.host }));
  const heading = blocks.find((b) => b.type === 'h1');
  const title = heading && heading.type !== 'ul' ? heading.text : policy ? w.privacy : w.terms;
  setPage({ title, description: w.about[policy ? 'privacy' : 'terms'].replace('{app}', BRAND.name), index: true });
  mount(
    root,
    html`
      <article class="legal" aria-labelledby="legal-title" lang="${w.lang}">
        <button class="text-button legal__back" type="button" data-back>${icon(ArrowLeft, 18)}${w.back}</button>
        <h1 class="page-title" id="legal-title" tabindex="-1" data-focus>${title}</h1>
        <div class="legal__text">
          ${blocks.map(block)}
          <p class="legal__other"><a href="${policy ? w.paths.terms : w.paths.privacy}">${policy ? w.terms : w.privacy}</a></p>
          <p class="legal__other legal__other--lang"><a href="${policy ? w.paths.otherPrivacy : w.paths.otherTerms}" lang="${w.lang === 'en' ? 'es' : 'en'}">${w.other}</a></p>
        </div>
      </article>`,
  );
  $('[data-back]', root).addEventListener('click', () => (history.length > 1 && document.referrer.startsWith(location.origin) ? history.back() : location.assign('/')));
}
