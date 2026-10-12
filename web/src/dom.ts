import { createElement, type IconNode } from 'lucide';

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escape = (v: string) => v.replace(/[&<>"']/g, (c) => ESC[c]);

/** Marks a string as trusted markup so `html` does not escape it. */
export class Raw {
  readonly value: string;
  constructor(value: string) {
    this.value = value;
  }
  toString() {
    return this.value;
  }
}
export const raw = (v: string) => new Raw(v);

type Part = string | number | Raw | null | undefined | false | Part[];
const flat = (v: Part): string =>
  Array.isArray(v) ? v.map(flat).join('') : v instanceof Raw ? v.value : v === null || v === undefined || v === false ? '' : escape(String(v));

export function html(strings: TemplateStringsArray, ...values: Part[]): Raw {
  return raw(strings.reduce((out, s, i) => out + s + (i < values.length ? flat(values[i]) : ''), ''));
}

export function icon(node: IconNode, size = 20, extra = ''): Raw {
  const el = createElement(node);
  el.setAttribute('width', String(size));
  el.setAttribute('height', String(size));
  el.setAttribute('aria-hidden', 'true');
  el.setAttribute('focusable', 'false');
  el.setAttribute('stroke-width', '2.25');
  if (extra) el.setAttribute('class', `icon ${extra}`);
  else el.setAttribute('class', 'icon');
  return raw(el.outerHTML);
}

export function mount(target: Element, markup: Raw) {
  target.innerHTML = markup.value;
}

export const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector<T>(sel)!;
export const $$ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => Array.from(root.querySelectorAll<T>(sel));

export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Run a DOM update inside a view transition when supported and motion is allowed. */
export function transition(updateDom: () => void): Promise<void> {
  if (!document.startViewTransition || reducedMotion()) {
    updateDom();
    return Promise.resolve();
  }
  return document.startViewTransition(updateDom).finished.catch(() => {});
}
