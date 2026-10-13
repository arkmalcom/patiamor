import { House, MapPin, PawPrint, User } from 'lucide';
import { leaves } from '../art';
import { ageMonths, frameFor, type PetSummary } from '../data';
import { html, icon, type Raw } from '../dom';
import { formatAge, t, away } from '../i18n';
import type { Placed } from '../store';

export function age(pet: PetSummary): string {
  const m = ageMonths(pet.birthDate);
  return m === null ? t('age.unknown') : formatAge(m);
}

export function facts(pet: PetSummary): Raw {
  const rows: [string, string][] = [
    [t('fact.age'), age(pet)],
    [t('fact.size'), t(`size.${pet.size}`)],
    [t('fact.energy'), t(`energy.${pet.energy}`)],
    [t('fact.sex'), t(`sex.${pet.sex}`)],
  ];
  return html`<dl class="facts">${rows.map(([k, v]) => html`<div class="facts__cell"><dt>${k}</dt><dd>${v}</dd></div>`)}</dl>`;
}

/** Who is giving the pet up: a verified shelter's name, or "Particular" (never a person's name). */
export function listerLabel(pet: PetSummary): Raw {
  return pet.lister.type === 'shelter'
    ? html`<span class="lister">${icon(House, 15)}${pet.lister.name}</span>`
    : html`<span class="lister">${icon(User, 15)}${t('lister.private')}</span>`;
}

export function where(p: Placed): Raw {
  return html`<p class="where">${icon(MapPin, 16)}<span><strong>${away(p.km)}</strong> · ${p.pet.place.name}</span></p>`;
}

/** The photo, or a quiet empty canvas when the lister hasn't added one yet. */
export function photo(pet: PetSummary, loading: 'eager' | 'lazy' = 'lazy'): Raw {
  return pet.photo.url
    ? html`<img src="${pet.photo.url}" alt="" style="object-position:${pet.photo.focus}" loading="${loading}" decoding="async" draggable="false" />`
    : html`<span class="no-photo">${icon(PawPrint, 34)}<span>${t('photo.none')}</span></span>`;
}

interface CanvasOpts {
  index?: number;
  heading?: 'h1' | 'h2';
  loading?: 'eager' | 'lazy';
  photoName?: string;
}

/** A pet presented as a market painting: painted two-tone frame, name on the lower band. */
export function canvas(p: Placed, { index = 0, heading = 'h2', loading = 'eager', photoName }: CanvasOpts = {}): Raw {
  const { pet } = p;
  const name = heading === 'h1' ? html`<h1 class="canvas__name" id="pet-name" tabindex="-1">${pet.name}</h1>` : html`<h2 class="canvas__name">${pet.name}</h2>`;
  return html`
    <div class="canvas" data-frame="${frameFor(pet.id)}">
      <div class="canvas__leaves">${leaves(index)}</div>
      <div class="canvas__frame-shadow">
        <div class="canvas__frame">
          <div class="canvas__picture"${photoName ? html` style="view-transition-name:${photoName}"` : ''}>${photo(pet, loading)}</div>
          <div class="canvas__band">
            ${name}
            ${where(p)}
            ${listerLabel(pet)}
          </div>
          ${facts(pet)}
        </div>
      </div>
    </div>`;
}

/** Small framed thumbnail used in lists and sheets. */
export function miniFrame(pet: PetSummary, size: 'sm' | 'md' = 'md'): Raw {
  return html`<span class="mini-frame mini-frame--${size}" data-frame="${frameFor(pet.id)}">${photo(pet)}</span>`;
}
