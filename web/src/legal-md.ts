// The privacy policy and the terms live as Markdown in docs/legal/ (the one source, readable and reviewable
// as text); the app shows them as pages at /privacidad and /terminos (views/legal.ts). Only the little
// Markdown they use is understood: two heading levels, paragraphs, bullet lists, **bold** and links to each
// other. The product's name and contact address are filled in from brand.ts, so a rename needs no edit here.

export type Block = { type: 'h1' | 'h2' | 'p'; text: string } | { type: 'ul'; items: string[] };

/** Fills in what a rename changes: the name, the contact email, and the address the site is served from. */
export function fill(md: string, brand: { name: string; contactEmail: string; host: string }): string {
  return md.replaceAll('hola@patiamor.com', brand.contactEmail).replaceAll('(patiamor.com)', `(${brand.host})`).replaceAll('Patiamor', brand.name);
}

export function parseMarkdown(md: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  const endParagraph = () => {
    if (paragraph.length) blocks.push({ type: 'p', text: paragraph.join(' ') });
    paragraph = [];
  };
  for (const raw of md.split('\n')) {
    const line = raw.trimEnd();
    if (!line.trim()) endParagraph();
    else if (line.startsWith('## ')) (endParagraph(), blocks.push({ type: 'h2', text: line.slice(3) }));
    else if (line.startsWith('# ')) (endParagraph(), blocks.push({ type: 'h1', text: line.slice(2) }));
    else if (line.startsWith('- ')) {
      endParagraph();
      const last = blocks.at(-1);
      if (last?.type === 'ul') last.items.push(line.slice(2));
      else blocks.push({ type: 'ul', items: [line.slice(2)] });
    } else paragraph.push(line.trim());
  }
  endParagraph();
  return blocks;
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** The pages these texts may link to; every other link is shown as plain text. */
const PAGES: Record<string, string> = { './privacidad.md': '/privacidad', './terminos.md': '/terminos', './privacy.en.md': '/en/privacy', './terms.en.md': '/en/terms' };

/** One line of text as safe HTML: everything escaped first, then **bold** and links to the other page. */
export function inline(text: string): string {
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_whole, label: string, target: string) => (PAGES[target] ? `<a href="${PAGES[target]}">${label}</a>` : label));
}
