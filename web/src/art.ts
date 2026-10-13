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

const BASE = 236; // y of the sidewalk line in the 0 0 1600 300 viewBox

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

function street(): string {
  let x = -40;
  const houses = STREET.map((d) => {
    const out = house(x, d);
    x += d.w + 4;
    return out;
  }).join('');
  return `
    <svg class="street" viewBox="0 0 1600 300" preserveAspectRatio="xMidYMax slice" aria-hidden="true" focusable="false">
      <path d="M0 120 C 260 70, 560 74, 820 104 C 1080 134, 1320 96, 1600 84 L1600 300 L0 300 Z" fill="var(--hill-far)"/>
      ${houses}
      <rect x="0" y="${BASE}" width="1600" height="10" fill="var(--paper)"/>
      <rect x="0" y="${BASE + 10}" width="1600" height="${300 - BASE - 10}" fill="var(--street)"/>
    </svg>`;
}

/** The painted street every screen sits on. */
export const landscape = raw(street());
