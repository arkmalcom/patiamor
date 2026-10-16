import { describe, expect, it } from 'vitest';
import privacidad from '../../docs/legal/privacidad.md?raw';
import terminos from '../../docs/legal/terminos.md?raw';
import { fill, inline, parseMarkdown } from '../../web/src/legal-md';

// The privacy policy and the terms are published exactly as written in docs/legal/ (owner decision,
// 2026-10-16), so the files must be publishable: no draft markers, no placeholders to fill in later, and
// nothing that spells the product's name or address in a way a rename wouldn't change.

const docs = { privacidad, terminos };

describe.each(Object.entries(docs))('%s', (_name, md) => {
  it('is ready to publish: no draft banner, no notes for later, no placeholders', () => {
    expect(md).not.toMatch(/BORRADOR|abogado|\[[^\]]*\](?!\()/i);
    expect(md.split('\n').some((l) => l.startsWith('>'))).toBe(false);
    expect(md).toMatch(/Última actualización:\*\* \d+ de \w+ de \d{4}/);
  });

  it('is only the Markdown the page understands', () => {
    const blocks = parseMarkdown(md);
    expect(blocks[0]).toMatchObject({ type: 'h1' });
    expect(blocks.filter((b) => b.type === 'h2').length).toBeGreaterThan(3);
    const shown = blocks.flatMap((b) => (b.type === 'ul' ? b.items : [b.text])).map(inline);
    for (const html of shown) expect(html).not.toMatch(/\*\*|\]\(|^#|<script/);
  });

  it('follows a rename: the name, email and address come from brand.ts', () => {
    const other = fill(md, { name: 'Nuevonombre', contactEmail: 'contacto@nuevo.do', host: 'nuevo.do' });
    expect(other).not.toMatch(/patiamor/i);
    expect(other).toContain('contacto@nuevo.do');
  });
});

describe('links', () => {
  it('only point to the other page; anything else is plain text', () => {
    expect(inline('Lee la [Política de privacidad](./privacidad.md).')).toBe('Lee la <a href="/privacidad">Política de privacidad</a>.');
    expect(inline('[Términos](./terminos.md)')).toBe('<a href="/terminos">Términos</a>');
    expect(inline('[clic](javascript:alert)')).toBe('clic');
    expect(inline('[clic](javascript:alert(1))')).not.toContain('<a');
    expect(inline('[x](https://otro.sitio)')).toBe('x');
  });

  it('escape what the text contains', () => {
    expect(inline('<img src=x onerror=alert(1)> **bien**')).toBe('&#60;img src=x onerror=alert(1)&#62; <strong>bien</strong>');
  });

  it('the terms link to the policy', () => {
    expect(terminos).toContain('(./privacidad.md)');
  });
});
