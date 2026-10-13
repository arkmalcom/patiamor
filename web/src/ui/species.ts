import { Cat, Dog, PawPrint, type IconNode } from 'lucide';
import type { SpeciesFilter } from '../data';
import { $$, html, icon, type Raw } from '../dom';
import { t } from '../i18n';
import { speciesCounts, state, update } from '../store';

// A three-position switch: Perros | Ambos | Gatos. "Ambos" sits in the middle like a toggle's neutral
// position, so choosing both is as obvious as choosing one. It's a radio group underneath.

const OPTIONS: [SpeciesFilter, IconNode][] = [
  ['perro', Dog],
  ['todos', PawPrint],
  ['gato', Cat],
];

export function speciesSwitch(): Raw {
  const counts = speciesCounts();
  return html`
    <fieldset class="species" data-value="${state.species}">
      <legend class="sr-only">${t('species.legend')}</legend>
      <span class="species__thumb" aria-hidden="true"></span>
      ${OPTIONS.map(
        ([value, glyph]) => html`
          <label class="species__opt">
            <input type="radio" name="species" value="${value}" ${state.species === value ? 'checked' : ''} />
            ${icon(glyph, 18)}<span class="species__label">${t(`species.${value}`)}</span>
            <span class="species__count" aria-label="(${counts[value]})">${counts[value]}</span>
          </label>`,
      )}
    </fieldset>`;
}

export function bindSpeciesSwitch(root: ParentNode) {
  for (const input of $$<HTMLInputElement>('.species input', root)) {
    input.addEventListener('change', () => {
      const fieldset = input.closest<HTMLElement>('.species')!;
      fieldset.dataset.value = input.value; // slide the thumb now; the re-render keeps it there
      update((s) => (s.species = input.value as SpeciesFilter));
      // Keep keyboard focus on the switch after the deck re-renders.
      document.querySelector<HTMLInputElement>(`.species input[value="${input.value}"]`)?.focus({ preventScroll: true });
    });
  }
}
