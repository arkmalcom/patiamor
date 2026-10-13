import { Check, LocateFixed, MapPin, Search } from 'lucide';
import { api } from '../api';
import { frameFor, type AgeGroup, type Companion, type Energy, type Place, type Sex, type Size } from '../data';
import { $, $$, html, icon, mount, type Raw } from '../dom';
import { animals, t, type Key } from '../i18n';

type PlaceKind = 'municipio' | 'distrito_municipal' | 'barrio' | 'paraje';
import { inReach, matchesFilters, placed, RADIUS_MAX, RADIUS_MIN, setLocation, state, update, type Filters } from '../store';
import { rollTo } from './roll';
import { toast } from './toast';

// Slider position (0–100) maps to km on a square curve: fine control nearby, reach to the whole country.
const toKm = (v: number) => Math.round(RADIUS_MIN + (RADIUS_MAX - RADIUS_MIN) * (v / 100) ** 2);
const toSlider = (km: number) => Math.round(100 * Math.sqrt((km - RADIUS_MIN) / (RADIUS_MAX - RADIUS_MIN)));

// Radar geometry: same square-root curve so the slider and the painted disk move together.
const R = 138;
const rOf = (km: number) => R * Math.sqrt(Math.min(km, RADIUS_MAX) / RADIUS_MAX);
const RINGS = [5, 15, 30, 60, 120];

/** Pets from the same area fan out slightly around its bearing so each stays visible. */
function dots(): Raw {
  const perPlace = new Map<string, number>();
  const counts = new Map<string, number>();
  for (const p of placed) counts.set(p.pet.place.id, (counts.get(p.pet.place.id) ?? 0) + 1);
  return html`${placed.map((p) => {
    const n = counts.get(p.pet.place.id)!;
    const i = perPlace.get(p.pet.place.id) ?? 0;
    perPlace.set(p.pet.place.id, i + 1);
    const angle = ((p.bearing + (i - (n - 1) / 2) * 9) * Math.PI) / 180;
    const r = Math.max(rOf(p.km), 16 + i * 4);
    return html`<circle class="radar__dot" data-id="${p.pet.id}" data-frame="${frameFor(p.pet.id)}" cx="${(Math.sin(angle) * r).toFixed(1)}" cy="${(-Math.cos(angle) * r).toFixed(1)}" r="6.5"><title>${p.pet.name} · ${p.pet.place.name}</title></circle>`;
  })}`;
}

function radar(): Raw {
  return html`
    <svg class="radar" viewBox="-150 -150 300 300" role="img" aria-labelledby="radar-label">
      <title id="radar-label">${t('sheet.radius.label')}</title>
      <circle class="radar__disk" r="${R}" />
      ${RINGS.map((km) => html`<circle class="radar__ring" r="${rOf(km).toFixed(1)}" /><text class="radar__ring-label" y="${(-rOf(km) - 3).toFixed(1)}">${km}</text>`)}
      <g data-dots>${dots()}</g>
      <circle class="radar__you-halo" r="11" />
      <circle class="radar__you" r="5.5" />
    </svg>`;
}

const fromLabel = () => (state.location ? t('sheet.radius.from', { place: state.location.name, city: state.location.municipality }) : t('place.unset'));

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
      <div class="location">
        <div class="location-row">
          ${icon(MapPin, 18)}
          <span data-location>${fromLabel()}</span>
          <button class="text-button" type="button" data-change aria-expanded="false" aria-controls="place-search-${mode}">${t('place.change')}</button>
        </div>
        <div class="place-search" id="place-search-${mode}" hidden data-search>
          <label class="field">
            <span class="field__label">${t('place.searchLabel')}</span>
            <span class="place-search__input">
              ${icon(Search, 18)}
              <input class="field__input" type="search" autocomplete="off" role="combobox" aria-autocomplete="list" aria-expanded="false"
                aria-controls="place-results-${mode}" placeholder="${t('place.searchPlaceholder')}" data-query />
            </span>
          </label>
          <ul class="place-results" id="place-results-${mode}" role="listbox" data-results></ul>
          <button class="text-button" type="button" data-locate>${icon(LocateFixed, 16)}${t('sheet.radius.locate')}</button>
          <p class="sample-note">${t('place.attribution')}</p>
        </div>
      </div>
      <div class="radar-wrap">
        <div data-radar>${radar()}</div>
        <p class="radar__count"><span class="roll" data-roll data-label=""></span><span class="radar__count-label" data-count-label></span></p>
      </div>
      <div class="radius-control">
        <label class="radius-control__label" for="radius-${mode}">${t('sheet.radius.label')}</label>
        <output class="radius-control__value" for="radius-${mode}" data-km-out></output>
        <input class="slider" id="radius-${mode}" type="range" min="0" max="100" step="1" data-radius />
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
    for (const d of $$<SVGCircleElement>('.radar__dot', root)) {
      const p = placed.find((q) => q.pet.id === d.dataset.id);
      if (!p) continue;
      d.classList.toggle('is-in', p.km <= km);
      d.classList.toggle('is-filtered', !matchesFilters(p.pet, draft.filters));
    }
    const label = t('sheet.radius.count', { animals: animals(n, state.species) });
    roll.dataset.label = label;
    rollTo(roll, n);
    countLabel.textContent = label;
    chips.forEach((c) => {
      const list = draft.filters[c.dataset.group as Group] as string[];
      c.setAttribute('aria-pressed', String(list.includes(c.dataset.value!)));
    });
    if (apply) {
      apply.disabled = n === 0;
      apply.textContent = n === 0 ? t('sheet.apply.none') : t('sheet.apply', { n, animals: animals(n, state.species) });
    }
  };

  /** New pets or a new origin: redraw the dots, keep the disk and its transition. */
  const redraw = () => {
    mount($('[data-dots]', root), dots());
    $('[data-location]', root).textContent = fromLabel();
    paint();
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

  $('[data-clear]', root).addEventListener('click', () => {
    draft.filters = { size: [], age: [], sex: [], energy: [], goodWith: [] };
    paint();
    commit();
  });

  apply?.addEventListener('click', () => {
    update((s) => ((s.radiusKm = draft.radiusKm), (s.filters = structuredClone(draft.filters))));
    onApply?.();
  });

  // ---------- Location: search a sector, or use the device's position (rounded to its nearest place) ----------
  const search = $('[data-search]', root);
  const changeBtn = $('[data-change]', root);
  const query = $<HTMLInputElement>('[data-query]', root);
  const results = $<HTMLUListElement>('[data-results]', root);
  let found: Place[] = [];
  let active = -1;

  const choose = async (place: Place) => {
    search.hidden = true;
    changeBtn.setAttribute('aria-expanded', 'false');
    query.value = '';
    mount(results, html``);
    $('[data-location]', root).textContent = fromLabel();
    await setLocation(place);
    redraw();
  };

  const renderResults = () => {
    query.setAttribute('aria-expanded', String(found.length > 0));
    mount(
      results,
      html`${found.map(
        (p, i) => html`<li role="option" id="place-opt-${mode}-${i}" class="place-option" aria-selected="${String(i === active)}" data-i="${i}">
          <strong>${p.name}</strong><span class="muted">${p.kind ? `${t(`kind.${p.kind as PlaceKind}`)} · ` : ''}${p.hint ? `${p.hint} · ` : ''}${p.kind === 'municipio' ? p.province : `${p.municipality}, ${p.province}`}</span>
        </li>`,
      )}${query.value.trim().length >= 2 && !found.length ? html`<li class="place-empty">${t('place.noResults')}</li>` : ''}`,
    );
    if (active >= 0) query.setAttribute('aria-activedescendant', `place-opt-${mode}-${active}`);
    else query.removeAttribute('aria-activedescendant');
  };

  changeBtn.addEventListener('click', () => {
    search.hidden = !search.hidden;
    changeBtn.setAttribute('aria-expanded', String(!search.hidden));
    if (!search.hidden) query.focus();
  });

  let searchTimer = 0;
  let searchSeq = 0;
  query.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const q = query.value.trim();
    if (q.length < 2) {
      found = [];
      active = -1;
      return renderResults();
    }
    searchTimer = window.setTimeout(async () => {
      const seq = ++searchSeq;
      try {
        const places = await api.searchPlaces(q);
        if (seq !== searchSeq) return;
        found = places;
        active = places.length ? 0 : -1;
        renderResults();
      } catch {
        toast(t('auth.err.network'));
      }
    }, 180);
  });
  query.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!found.length) return;
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + found.length) % found.length;
      renderResults();
    } else if (e.key === 'Enter' && active >= 0) {
      e.preventDefault();
      void choose(found[active]);
    } else if (e.key === 'Escape') {
      e.stopPropagation();
      search.hidden = true;
      changeBtn.setAttribute('aria-expanded', 'false');
      changeBtn.focus();
    }
  });
  results.addEventListener('click', (e) => {
    const li = (e.target as HTMLElement).closest<HTMLElement>('[data-i]');
    if (li) void choose(found[Number(li.dataset.i)]);
  });

  $('[data-locate]', root).addEventListener('click', () => {
    if (!('geolocation' in navigator)) return toast(t('geo.error'));
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          // Only a ~1 km rounded point leaves the device; distances are then measured from that area.
          const place = await api.nearestPlace({ lat: pos.coords.latitude, lng: pos.coords.longitude });
          await choose(place);
          toast(t('place.located', { place: place.name }));
        } catch {
          toast(t('geo.outside'));
        }
      },
      () => toast(t('geo.error')),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 600000 },
    );
  });

  paint();
  return {
    refresh() {
      if (document.activeElement === slider) return;
      draft.radiusKm = state.radiusKm;
      draft.filters = structuredClone(state.filters);
      slider.value = String(toSlider(draft.radiusKm));
      redraw();
    },
  };
}
