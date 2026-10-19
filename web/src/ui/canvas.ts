import { Baby, Cat, Check, CircleHelp, Dog, House, MapPin, PawPrint, User, X, type IconNode } from 'lucide';
import { ageMonths, companionKey, frameFor, type Companion, type PetSummary } from '../data';
import { html, icon, type Raw } from '../dom';
import { formatAge, t, away } from '../i18n';
import { galleryControls } from './gallery';
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

/** The photo, or a quiet empty canvas when the lister hasn't added one yet. Small frames take the thumbnail.
 *  Where the name sits right beside it (cards, lists) the photo needs no alt; the profile's own says who and where. */
export function photo(pet: PetSummary, loading: 'eager' | 'lazy' = 'lazy', small = false, alt = ''): Raw {
  const src = small ? (pet.photo.thumb ?? pet.photo.url) : pet.photo.url;
  return src
    ? html`<img src="${src}" alt="${alt}" style="object-position:${pet.photo.focus}" loading="${loading}" decoding="async" draggable="false" />`
    : html`<span class="no-photo">${icon(PawPrint, 34)}<span>${t('photo.none')}</span></span>`;
}

interface CanvasOpts {
  heading?: 'h1' | 'h2';
  loading?: 'eager' | 'lazy';
  photoName?: string;
  /** Pips and arrows for going through the photos (bind with bindGallery after mounting). */
  gallery?: 'card' | 'profile';
}

/** "Otros perros" on a dog's card, "Perros" on a cat's (and the reverse for cats). */
export function companionLabel(c: Companion, pet: PetSummary): string {
  if (pet.species === 'gato' && c === 'perros') return t('companion.perros.forCat');
  if (pet.species === 'gato' && c === 'gatos') return t('companion.gatos.forCat');
  return t(`companion.${c}`);
}

const COMPANIONS: [Companion, IconNode][] = [
  ['ninos', Baby],
  ['perros', Dog],
  ['gatos', Cat],
];

/** Convivencia at a glance: three painted badges, each marked with a shape (check, cross, question), never colour alone. */
export function compat(pet: PetSummary): Raw {
  const items = COMPANIONS.map(([c, glyph]) => {
    const v = pet.goodWith[companionKey[c]];
    const [cls, mark, word] = v === true ? ['yes', Check, t('compat.yes')] : v === false ? ['no', X, t('compat.no')] : ['unknown', CircleHelp, t('compat.unknown')];
    return { c, glyph, cls, mark, text: `${companionLabel(c, pet)}: ${word}` };
  });
  return html`<ul class="compat" aria-label="${t('compat.label')}: ${items.map((i) => i.text).join(', ')}">${items.map(
    (i) => html`<li class="compat__badge compat__badge--${i.cls}" title="${i.text}">${icon(i.glyph, 17)}<span class="compat__mark">${icon(i.mark, 11)}</span></li>`,
  )}</ul>`;
}

/** A pet's portrait: an arched, hand-painted frame (echoing the street's arched doors), the name on a
 *  painted sign nailed across it, and convivencia badges at the photo's corner. */
export function canvas(p: Placed, { heading = 'h2', loading = 'eager', photoName, gallery }: CanvasOpts = {}): Raw {
  const { pet } = p;
  const name = heading === 'h1' ? html`<h1 class="canvas__name" id="pet-name" tabindex="-1">${pet.name}</h1>` : html`<h2 class="canvas__name">${pet.name}</h2>`;
  return html`
    <div class="canvas" data-frame="${frameFor(pet.id)}">
      <div class="canvas__frame-shadow">
        <div class="canvas__frame">
          <div class="canvas__photo">
            <div class="canvas__picture"${photoName ? html` style="view-transition-name:${photoName}"` : ''}>${photo(pet, loading, false, heading === 'h1' ? t('photo.alt', { name: pet.name, place: pet.place.name }) : '')}</div>
            ${gallery ? galleryControls(pet, gallery) : ''}
            ${compat(pet)}
          </div>
          <div class="canvas__band rotulo">
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
  return html`<span class="mini-frame mini-frame--${size}" data-frame="${frameFor(pet.id)}">${photo(pet, 'lazy', true)}</span>`;
}
