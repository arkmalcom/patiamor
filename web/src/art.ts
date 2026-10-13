import { raw } from './dom';

// "Ventanas de casa": adoption as coming home. A flat painted street of Dominican colonial houses
// (Zona Colonial / Puerto Plata) runs along the bottom of every screen; each pet looks out of a window.

type Roof = 'parapet' | 'pitched' | 'arched';
interface House {
  w: number;
  h: number;
  wall: string;
  trim: string;
  roof: Roof;
  windows: number;
  door: 'square' | 'arched';
}

// A fixed row, so the street is the same on every load. Walls are pale versions of the frame paints;
// shutters and doors take the strong paints, the way Dominican facades do.
const STREET: House[] = [
  { w: 150, h: 128, wall: 'var(--casa-mango)', trim: 'var(--anil)', roof: 'parapet', windows: 2, door: 'square' },
  { w: 118, h: 150, wall: 'var(--casa-turquesa)', trim: 'var(--hoja)', roof: 'pitched', windows: 1, door: 'arched' },
  { w: 170, h: 120, wall: 'var(--casa-rosa)', trim: 'var(--turquesa)', roof: 'arched', windows: 2, door: 'arched' },
  { w: 128, h: 140, wall: 'var(--casa-anil)', trim: 'var(--mango)', roof: 'parapet', windows: 1, door: 'square' },
  { w: 160, h: 132, wall: 'var(--casa-hoja)', trim: 'var(--anil)', roof: 'pitched', windows: 2, door: 'square' },
  { w: 120, h: 118, wall: 'var(--casa-mango)', trim: 'var(--hoja)', roof: 'arched', windows: 1, door: 'arched' },
  { w: 156, h: 146, wall: 'var(--casa-turquesa)', trim: 'var(--anil)', roof: 'parapet', windows: 2, door: 'arched' },
  { w: 132, h: 124, wall: 'var(--casa-rosa)', trim: 'var(--hoja)', roof: 'pitched', windows: 1, door: 'square' },
  { w: 168, h: 136, wall: 'var(--casa-anil)', trim: 'var(--turquesa)', roof: 'parapet', windows: 2, door: 'square' },
  { w: 124, h: 128, wall: 'var(--casa-hoja)', trim: 'var(--mango)', roof: 'arched', windows: 1, door: 'arched' },
  { w: 150, h: 142, wall: 'var(--casa-mango)', trim: 'var(--turquesa)', roof: 'pitched', windows: 2, door: 'square' },
];

const BASE = 236; // y of the sidewalk line in the 300-tall viewBox

/** A painted window with open shutters (slats as a few strokes). */
function facadeWindow(x: number, y: number, trim: string): string {
  const w = 22, h = 32;
  const slats = (sx: number) => Array.from({ length: 5 }, (_, i) => `M${sx} ${y + 5 + i * 6}h9`).join('');
  return `
    <rect x="${x - 11}" y="${y}" width="10" height="${h}" fill="${trim}"/>
    <rect x="${x + w + 1}" y="${y}" width="10" height="${h}" fill="${trim}"/>
    <path d="${slats(x - 10.5)}${slats(x + w + 1.5)}" stroke="var(--street-line)" stroke-width="1.6"/>
    <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="var(--street-glass)"/>
    <rect x="${x - 3}" y="${y + h}" width="${w + 6}" height="4" fill="var(--paper)"/>`;
}

function house(x: number, d: House): string {
  const top = BASE - d.h;
  const parts: string[] = [`<rect x="${x}" y="${top}" width="${d.w}" height="${d.h}" fill="${d.wall}"/>`];
  if (d.roof === 'parapet') {
    parts.push(`<rect x="${x - 4}" y="${top - 10}" width="${d.w + 8}" height="12" fill="var(--paper)"/>`);
  } else if (d.roof === 'pitched') {
    // Puerto Plata gingerbread: a pitched roof with a fretwork fringe of half-circles.
    parts.push(`<path d="M${x - 8} ${top} L${x + d.w / 2} ${top - 34} L${x + d.w + 8} ${top} Z" fill="${d.trim}"/>`);
    const n = Math.floor((d.w + 16) / 12);
    parts.push(`<path d="${Array.from({ length: n }, (_, i) => `M${x - 8 + i * 12} ${top}a6 6 0 0 0 12 0`).join('')}" fill="var(--paper)"/>`);
  } else {
    parts.push(`<path d="M${x - 2} ${top + 2} Q ${x + d.w / 2} ${top - 26} ${x + d.w + 2} ${top + 2} Z" fill="var(--paper)"/>`);
  }
  // Door, centred, with its own colour.
  const dw = 26, dh = 46, dx = x + d.w / 2 - dw / 2;
  parts.push(
    d.door === 'arched'
      ? `<path d="M${dx} ${BASE} V${BASE - dh + 13} a13 13 0 0 1 26 0 V${BASE} Z" fill="${d.trim}"/>`
      : `<rect x="${dx}" y="${BASE - dh}" width="${dw}" height="${dh}" fill="${d.trim}"/>`,
  );
  // One window centred above the door, or two flanking it.
  const wy = top + 18;
  if (d.windows === 1) parts.push(facadeWindow(x + d.w / 2 - 11, wy, d.trim));
  else {
    parts.push(facadeWindow(x + 22, wy + 8, d.trim));
    parts.push(facadeWindow(x + d.w - 44, wy + 8, d.trim));
  }
  return parts.join('');
}

// The drawing is much wider than any screen. The CSS fills the width and keeps the street on the ground
// (xMidYMax slice), so a wide or short window crops the sides, never the roofs: a 1600-wide drawing lost
// its rooftops from about 1920px wide. Phones and laptops see the middle at the same scale as before.
const WIDTH = 4800;

function street(): string {
  const houses: string[] = [];
  // The fixed row repeats until the street is full, so it stays the same on every load.
  for (let x = -40, i = 0; x < WIDTH; i++) {
    const d = STREET[i % STREET.length];
    houses.push(house(x, d));
    x += d.w + 4;
  }
  // Gentle hills behind the houses: a smooth wave that repeats across the whole width.
  const hills = `M0 112 Q 200 72 400 104${Array.from({ length: WIDTH / 400 - 1 }, (_, i) => ` T ${800 + i * 400} 104`).join('')} L${WIDTH} 300 L0 300 Z`;
  return `
    <svg class="street" viewBox="0 0 ${WIDTH} 300" preserveAspectRatio="xMidYMax slice" aria-hidden="true" focusable="false">
      <path d="${hills}" fill="var(--hill-far)"/>
      ${houses.join('')}
      <rect x="0" y="${BASE}" width="${WIDTH}" height="10" fill="var(--paper)"/>
      <rect x="0" y="${BASE + 10}" width="${WIDTH}" height="${300 - BASE - 10}" fill="var(--street)"/>
    </svg>`;
}

// ---------- The wall behind everything: painted bands and faint motifs for the animals in view ----------

// Flat shapes drawn around (0, 0). One colour (the layer's ink) and the sky for cut-outs, so the whole
// motif fades as one when the layer's opacity is low.
const PAW = `<ellipse cx="0" cy="7" rx="10" ry="8.5"/><circle cx="-11" cy="-5" r="4"/><circle cx="-4.5" cy="-12" r="4.2"/><circle cx="4.5" cy="-12" r="4.2"/><circle cx="11" cy="-5" r="4"/>`;
const BONE = `<rect x="-15" y="-4" width="30" height="8" rx="3"/><circle cx="-15" cy="-4.5" r="5.5"/><circle cx="-15" cy="4.5" r="5.5"/><circle cx="15" cy="-4.5" r="5.5"/><circle cx="15" cy="4.5" r="5.5"/>`;
const YARN = `<circle r="14"/><path d="M-13 -4 C -5 -9, 6 -9, 13 -3 M-14 3 C -5 -2, 6 -2, 14 4 M-11 9 C -4 5, 5 5, 11 10 M-3 -14 C 4 -6, 4 6, -3 14" fill="none" stroke="var(--sky)" stroke-width="2.4" stroke-linecap="round"/><path d="M-10 10 C -14 16, -8 20, -13 25 C -17 29, -24 27, -27 31" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>`;
const FISH = `<path d="M-16 0 C -8 -11, 8 -11, 14 0 C 8 11, -8 11, -16 0 Z"/><path d="M12 0 L 24 -9 L 22 0 L 24 9 Z"/><circle cx="-8" cy="-2" r="2" fill="var(--sky)"/>`;

const at = (shape: string, x: number, y: number, deg: number, k = 1) => `<g transform="translate(${x} ${y}) rotate(${deg}) scale(${k})">${shape}</g>`;

// Both sets share one 280-unit tile and take different spots in it, so "Ambos" shows them side by side
// without collisions: dogs in the top-left and bottom-right of each tile, cats in the other two.
const TILE = 280;
const DOG_TILE = at(PAW, 52, 58, -18, 1.15) + at(BONE, 196, 206, 28) + at(PAW, 214, 104, 12, 0.8) + at(BONE, 76, 168, -40, 0.75);
const CAT_TILE = at(YARN, 206, 54, 0, 1.05) + at(FISH, 62, 214, -22, 1.1) + at(FISH, 238, 160, 160, 0.8) + at(YARN, 132, 120, 0, 0.7);

const motifs = `
  <svg class="motifs" aria-hidden="true" focusable="false">
    <defs>
      <pattern id="motif-dogs" width="${TILE}" height="${TILE}" patternUnits="userSpaceOnUse">${DOG_TILE}</pattern>
      <pattern id="motif-cats" width="${TILE}" height="${TILE}" patternUnits="userSpaceOnUse">${CAT_TILE}</pattern>
    </defs>
    <rect class="motifs__dogs" width="100%" height="100%" fill="url(#motif-dogs)"/>
    <rect class="motifs__cats" width="100%" height="100%" fill="url(#motif-cats)"/>
  </svg>`;

/** Painted bands and the animal motifs, fixed behind every screen. */
export const backdrop = raw(`<div class="backdrop" aria-hidden="true">${motifs}</div>`);

/** The painted street every screen sits on. */
export const landscape = raw(street());
