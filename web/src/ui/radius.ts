import { Check, LocateFixed, MapPin } from 'lucide';
import { shelterById, type AgeGroup, type Companion, type Energy, type Sex, type Size } from '../data';
import { $, $$, html, icon, type Raw } from '../dom';
import { t, type Key } from '../i18n';
import { here, inDR, inReach, matchesFilters, placed, RADIUS_MAX, RADIUS_MIN, setLocation, state, update, type Filters } from '../store';
import { rollTo } from './roll';
import { toast } from './toast';

// Slider position (0–100) maps to km on a square curve: fine control nearby, reach to the whole country.
const toKm = (v: number) => Math.round(RADIUS_MIN + (RADIUS_MAX - RADIUS_MIN) * (v / 100) ** 2);
const toSlider = (km: number) => Math.round(100 * Math.sqrt((km - RADIUS_MIN) / (RADIUS_MAX - RADIUS_MIN)));

// Radar geometry: same square-root curve so the slider and the painted disk move together.
const R = 138;
const rOf = (km: number) => R * Math.sqrt(Math.min(km, RADIUS_MAX) / RADIUS_MAX);
const RINGS = [5, 15, 30, 60, 120];

function radar(): Raw {
  const byShelter = new Map<string, number>();
  const dots = placed.map((p) => {
    const n = placed.filter((q) => q.dog.shelterId === p.dog.shelterId).length;
    const i = byShelter.get(p.dog.shelterId) ?? 0;
    byShelter.set(p.dog.shelterId, i + 1);
    const angle = ((p.bearing + (i - (n - 1) / 2) * 9) * Math.PI) / 180;
    const r = Math.max(rOf(p.km), 16 + i * 4);
    const x = Math.sin(angle) * r;
    const y = -Math.cos(angle) * r;
    return html`<circle class="radar__dot" data-id="${p.dog.id}" data-frame="${p.dog.frame}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="6.5"><title>${p.dog.name} · ${shelterById.get(p.dog.shelterId)!.sector}</title></circle>`;
  });
  return html`
    <svg class="radar" viewBox="-150 -150 300 300" role="img" aria-labelledby="radar-label">
      <title id="radar-label">${t('sheet.radius.label')}</title>
      <circle class="radar__disk" r="${R}" />
      ${RINGS.map((km) => html`<circle class="radar__ring" r="${rOf(km).toFixed(1)}" /><text class="radar__ring-label" y="${(-rOf(km) - 3).toFixed(1)}">${km}</text>`)}
      ${dots}
      <circle class="radar__you-halo" r="11" />
      <circle class="radar__you" r="5.5" />
    </svg>`;
}

type Group = keyof Filters;
const GROUPS: { key: Group; title: Key; values: string[]; label: (v: string) => string }[] = [
  { key: 'size', title: 'sheet.filters.size', values: ['pequeno', 'mediano', 'grande'] satisfies Size[], label: (v) => t(`size.${v as Size}`) },
  { key: 'age', title: 'sheet.filters.age', values: ['cachorro', 'joven', 'adulto', 'mayor'] satisfies AgeGroup[], label: (v) => t(`agegroup.${v as AgeGroup}`) },
  { key: 'sex', title: 'sheet.filters.sex', values: ['hembra', 'macho'] satisfies Sex[], label: (v) => t(`sex.${v as Sex}`) },
  { key: 'energy', title: 'sheet.filters.energy', values: ['tranquila', 'media', 'alta'] satisfies Energy[], label: (v) => t(`energy.${v as Energy}`) },
  { key: 'goodWith', title: 'sheet.filters.goodWith', values: ['ninos', 'perros', 'gatos'] satisfies Companion[], label: (v) => t(`companion.${v as Companion}`) },
];

export function radiusPanel(mode: 'sheet' | 'inline'): Raw {
  return html`
    <div class="radius-panel radius-panel--${mode}">
      ${mode === 'inline' ? html`<h2 class="panel-title">${t('sheet.radius.title')}</h2>` : ''}
      <p class="muted">${t('sheet.radius.body')}</p>
      <div class="radar-wrap">
        ${radar()}
        <p class="radar__count"><span class="roll" data-roll data-label="${t('sheet.radius.count.many')}"></span><span class="radar__count-label" data-count-label></span></p>
      </div>
      <div class="radius-control">
        <label class="radius-control__label" for="radius-${mode}">${t('sheet.radius.label')}</label>
        <output class="radius-control__value" for="radius-${mode}" data-km-out></output>
        <input class="slider" id="radius-${mode}" type="range" min="0" max="100" step="1" data-radius />
      </div>
      <div class="location-row">
        ${icon(MapPin, 18)}
        <span data-location>${t('sheet.radius.from', { place: here.label, city: here.city })}</span>
        <button class="text-button" type="button" data-locate>${icon(LocateFixed, 16)}${t('sheet.radius.locate')}</button>
      </div>

      <div class="filters">
        <div class="filters__head">
          <h3 class="filters__title">${t('sheet.filters.title')}</h3>
          <button class="text-button" type="button" data-clear>${t('sheet.filters.clear')}</button>
        </div>
        ${GROUPS.map(
          (g) => html`
            <fieldset class="chip-group">
              <legend>${t(g.title)}</legend>
              <div class="chip-group__chips">
                ${g.values.map((v) => html`<button type="button" class="chip" data-group="${g.key}" data-value="${v}" aria-pressed="false">${icon(Check, 16, 'chip__check')}${g.label(v)}</button>`)}
              </div>
            </fieldset>`,
        )}
      </div>
      ${mode === 'inline' ? html`<p class="sample-note">${t('app.sampleNote')}</p>` : ''}
    </div>`;
}

export function applyFooter(): Raw {
  return html`<button class="button button--primary" type="button" data-apply></button>`;
}

interface BindOpts {
  mode: 'sheet' | 'inline';
  onApply?: () => void;
}

/** Wires a radius panel. Sheet mode edits a draft until applied; inline mode commits live. */
export function bindRadiusPanel(root: HTMLElement, { mode, onApply }: BindOpts) {
  const draft = { radiusKm: state.radiusKm, filters: structuredClone(state.filters) as Filters };
  const slider = $<HTMLInputElement>('[data-radius]', root);
  const out = $('[data-km-out]', root);
  const roll = $('[data-roll]', root);
  const countLabel = $('[data-count-label]', root);
  const disk = $('.radar__disk', root) as unknown as SVGCircleElement;
  const dots = $$<SVGCircleElement>('.radar__dot', root);
  const chips = $$<HTMLButtonElement>('.chip', root);
  const apply = root.closest('dialog')?.querySelector<HTMLButtonElement>('[data-apply]') ?? null;

  slider.value = String(toSlider(draft.radiusKm));

  const commit = () => {
    if (mode === 'inline') update((s) => ((s.radiusKm = draft.radiusKm), (s.filters = structuredClone(draft.filters))));
  };

  const paint = () => {
    const km = draft.radiusKm;
    const n = inReach(km, draft.filters).length;
    slider.style.setProperty('--control-value', slider.value);
    slider.setAttribute('aria-valuetext', `${km} km`);
    out.textContent = `${km} km`;
    disk.style.transform = `scale(${rOf(km) / R})`;
    dots.forEach((d) => {
      const p = placed.find((q) => q.dog.id === d.dataset.id)!;
      d.classList.toggle('is-in', p.km <= km);
      d.classList.toggle('is-filtered', !matchesFilters(p.dog, draft.filters));
    });
    rollTo(roll, n);
    countLabel.textContent = n === 1 ? t('sheet.radius.count.one') : t('sheet.radius.count.many');
    chips.forEach((c) => {
      const list = draft.filters[c.dataset.group as Group] as string[];
      c.setAttribute('aria-pressed', String(list.includes(c.dataset.value!)));
    });
    if (apply) {
      apply.disabled = n === 0;
      apply.textContent = n === 0 ? t('sheet.apply.none') : n === 1 ? t('sheet.apply.one') : t('sheet.apply.many', { n });
    }
  };

  let commitTimer = 0;
  slider.addEventListener('input', () => {
    draft.radiusKm = toKm(Number(slider.value));
    paint();
    clearTimeout(commitTimer);
    commitTimer = window.setTimeout(commit, 160);
  });

  chips.forEach((c) =>
    c.addEventListener('click', () => {
      const list = draft.filters[c.dataset.group as Group] as string[];
      const i = list.indexOf(c.dataset.value!);
      if (i >= 0) list.splice(i, 1);
      else list.push(c.dataset.value!);
      paint();
      commit();
    }),
  );

  const clear = () => {
    draft.filters = { size: [], age: [], sex: [], energy: [], goodWith: [] };
    paint();
    commit();
  };
  $('[data-clear]', root).addEventListener('click', clear);

  apply?.addEventListener('click', () => {
    update((s) => ((s.radiusKm = draft.radiusKm), (s.filters = structuredClone(draft.filters))));
    onApply?.();
  });

  $('[data-locate]', root).addEventListener('click', () => {
    if (!('geolocation' in navigator)) return toast(t('sheet.radius.from', { place: here.label, city: here.city }));
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const point = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        if (!inDR(point)) {
          toast(t('geo.outside'));
          return;
        }
        setLocation(point, t('geo.here'), t('geo.country'));
        $('[data-location]', root).textContent = t('sheet.radius.from', { place: here.label, city: here.city });
        paint();
      },
      () => toast(t('geo.error')),
      { enableHighAccuracy: false, timeout: 8000 },
    );
  });

  paint();
  return {
    refresh() {
      if (document.activeElement === slider) return;
      draft.radiusKm = state.radiusKm;
      draft.filters = structuredClone(state.filters);
      slider.value = String(toSlider(draft.radiusKm));
      paint();
    },
  };
}
