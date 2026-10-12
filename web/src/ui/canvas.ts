import { MapPin } from 'lucide';
import { leaves } from '../art';
import { shelterById, type Dog } from '../data';
import { html, icon, type Raw } from '../dom';
import { formatAge, formatKm, t } from '../i18n';
import type { Placed } from '../store';

export function facts(dog: Dog): Raw {
  const rows: [string, string][] = [
    [t('fact.age'), formatAge(dog.ageMonths)],
    [t('fact.size'), t(`size.${dog.size}`)],
    [t('fact.energy'), t(`energy.${dog.energy}`)],
    [t('fact.sex'), t(`sex.${dog.sex}`)],
  ];
  return html`<dl class="facts">${rows.map(([k, v]) => html`<div class="facts__cell"><dt>${k}</dt><dd>${v}</dd></div>`)}</dl>`;
}

export function where(p: Placed): Raw {
  const shelter = shelterById.get(p.dog.shelterId)!;
  return html`<p class="where">${icon(MapPin, 16)}<span><strong>${t('deck.away', { km: formatKm(p.km) })}</strong> · ${shelter.sector}</span></p>`;
}

interface CanvasOpts {
  index?: number;
  heading?: 'h1' | 'h2';
  loading?: 'eager' | 'lazy';
  photoName?: string;
}

/** A dog presented as a market painting: painted two-tone frame, name on the lower band. */
export function canvas(p: Placed, { index = 0, heading = 'h2', loading = 'eager', photoName }: CanvasOpts = {}): Raw {
  const { dog } = p;
  const name = heading === 'h1' ? html`<h1 class="canvas__name" id="dog-name" tabindex="-1">${dog.name}</h1>` : html`<h2 class="canvas__name">${dog.name}</h2>`;
  return html`
    <div class="canvas" data-frame="${dog.frame}">
      <div class="canvas__leaves">${leaves(index)}</div>
      <div class="canvas__frame-shadow">
        <div class="canvas__frame">
          <div class="canvas__picture"${photoName ? html` style="view-transition-name:${photoName}"` : ''}>
            <img src="${dog.photo}" alt="" style="object-position:${dog.focus}" loading="${loading}" decoding="async" draggable="false" />
          </div>
          <div class="canvas__band">
            ${name}
            ${where(p)}
          </div>
          ${facts(dog)}
        </div>
      </div>
    </div>`;
}

/** Small framed thumbnail used in lists and sheets. */
export function miniFrame(dog: Dog, size: 'sm' | 'md' = 'md'): Raw {
  return html`<span class="mini-frame mini-frame--${size}" data-frame="${dog.frame}"><img src="${dog.photo}" alt="" style="object-position:${dog.focus}" loading="lazy" /></span>`;
}
