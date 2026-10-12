import { raw, type Raw } from './dom';

// Flat leaf silhouettes in the manner of market naïf painting: one fill, a midrib, no shading.

const almond = (fill: string, rib: string) => `
  <svg viewBox="0 0 160 70" class="leaf" aria-hidden="true" focusable="false">
    <path d="M4 38 C 30 6, 104 -4, 156 20 C 120 54, 52 72, 4 38 Z" fill="${fill}"/>
    <path d="M10 37 C 60 30, 110 24, 150 21" fill="none" stroke="${rib}" stroke-width="2.5" stroke-linecap="round"/>
  </svg>`;

const plantain = (fill: string, cut: string) => `
  <svg viewBox="0 0 240 90" class="leaf" aria-hidden="true" focusable="false">
    <path d="M2 48 C 40 6, 170 -2, 238 34 C 176 82, 60 92, 2 48 Z" fill="${fill}"/>
    <path d="M8 47 C 80 40, 160 36, 232 35" fill="none" stroke="${cut}" stroke-width="3" stroke-linecap="round"/>
    <path d="M70 42 L 58 14 M112 39 L 104 8 M150 37 L 146 10 M96 41 L 84 78 M140 38 L 134 76 M182 36 L 184 66" stroke="${cut}" stroke-width="3" stroke-linecap="round"/>
  </svg>`;

export function leaves(variant: number): Raw {
  const deep = 'var(--hoja-deep)';
  const mid = 'var(--hoja)';
  const sky = 'var(--sky)';
  const sets = [
    `<span class="leaf-slot leaf-slot--tl">${plantain(deep, sky)}</span><span class="leaf-slot leaf-slot--br">${almond(mid, deep)}</span>`,
    `<span class="leaf-slot leaf-slot--tr">${almond(deep, mid)}</span><span class="leaf-slot leaf-slot--bl">${plantain(mid, sky)}</span>`,
    `<span class="leaf-slot leaf-slot--tl">${almond(mid, deep)}</span><span class="leaf-slot leaf-slot--br">${plantain(deep, sky)}</span>`,
  ];
  return raw(sets[variant % sets.length]);
}

/** The flat painted hill the deck sits on. */
export const landscape = raw(`
  <svg class="landscape" viewBox="0 0 1440 320" preserveAspectRatio="none" aria-hidden="true" focusable="false">
    <path d="M0 150 C 240 70, 520 60, 760 120 C 1000 180, 1220 120, 1440 80 L 1440 320 L 0 320 Z" fill="var(--hill-far)"/>
    <path d="M0 230 C 300 160, 640 170, 900 210 C 1120 244, 1300 200, 1440 180 L 1440 320 L 0 320 Z" fill="var(--hill-near)"/>
  </svg>`);
