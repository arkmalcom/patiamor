import { Check, LocateFixed, MapPin, Minus, Plus, Search, X } from 'lucide';
import { api } from '../api';
import { frameFor, type AgeGroup, type Companion, type Energy, type Place, type Sex, type Size } from '../data';
import { $, $$, html, icon, mount, type Raw } from '../dom';
import { animals, t, type Key } from '../i18n';

type PlaceKind = 'municipio' | 'distrito_municipal' | 'barrio' | 'paraje';
import { emptyFilters, inReach, matchesFilters, placed, RADIUS_MAX, RADIUS_MIN, setLocation, state, update, type Filters, type Placed } from '../store';
import { rollTo } from './roll';
import { toast } from './toast';

// Slider position (0–100) maps to km on a square curve: fine control nearby, reach to the whole country.
const toKm = (v: number) => Math.round(RADIUS_MIN + (RADIUS_MAX - RADIUS_MIN) * (v / 100) ** 2);
const toSlider = (km: number) => Math.round(100 * Math.sqrt((km - RADIUS_MIN) / (RADIUS_MAX - RADIUS_MIN)));

// Radar geometry: same square-root curve so the slider and the painted disk move together.
const R = 138;
const rOf = (km: number) => R * Math.sqrt(Math.min(km, RADIUS_MAX) / RADIUS_MAX);
const RINGS = [5, 15, 30, 60, 120];

/* Map markers. A shelter is one little house (all its animals are at the shelter); a privately listed pet
   is a dot, and several private pets in one neighbourhood share a numbered bubble. Markers that would
   cover each other first nudge apart a few pixels; if that isn't enough they merge into a bubble, so the
   map stays a readable set of counts however many animals there are. Markers are laid out in screen
   space at the current zoom, so zooming in splits bubbles back into houses and dots. */
type Marker = {
  kind: 'dot' | 'house' | 'bubble';
  members: Placed[];
  name: string; // shelter or place, for the tooltip
  hx: number; hy: number; // true position on screen
  x: number; y: number; // drawn position
  r: number; // footprint
};

/** The map's zoom: z× around the centre (cx, cy), in unzoomed map units. */
type View = { z: number; cx: number; cy: number };
const Z_MAX = 8;
const VIEW = 150; // half the viewBox

const MIN_R = 22; // keep markers (and house counts) clear of the person's own dot
const NUDGE = 9; // how far a marker may move from its true position before it merges instead
const HOUSE = 'M-8 0.5 L0 -8 L8 0.5 H6 V7.5 H-6 V0.5 Z';
const bubbleR = (n: number) => (n < 10 ? 8 : n < 100 ? 9.5 : 11.5);
const footprint = (m: Pick<Marker, 'kind' | 'members'>) => (m.kind === 'dot' ? 6.5 : m.kind === 'house' ? 13 : bubbleR(m.members.length));

/** Where the person's own dot is on screen. */
const you = (v: View): [number, number] => [-v.cx * v.z, -v.cy * v.z];

function home(p: Placed, v: View): [number, number] {
  const [ux, uy] = you(v);
  const a = (p.bearing * Math.PI) / 180;
  const r = Math.max(rOf(p.km) * v.z, MIN_R);
  return [ux + Math.sin(a) * r, uy - Math.cos(a) * r];
}

/** Keep a marker inside the disk and the view, and clear of the person's own dot. */
function clamp(m: Marker, v: View) {
  const [ux, uy] = you(v);
  const dx = m.x - ux, dy = m.y - uy;
  const r = Math.hypot(dx, dy) || 0.01;
  const k = Math.min(Math.max(r, MIN_R), R * v.z - m.r) / r;
  m.x = Math.max(-VIEW + m.r, Math.min(VIEW - m.r, ux + dx * k));
  m.y = Math.max(-VIEW + m.r, Math.min(VIEW - m.r, uy + dy * k));
}

function markers(v: View): Marker[] {
  const groups = new Map<string, Marker>();
  for (const p of placed) {
    const l = p.pet.lister;
    const key = l.type === 'shelter' ? `s:${l.id}` : `p:${p.pet.place.id}`;
    const g = groups.get(key);
    if (g) {
      g.members.push(p);
      if (g.kind === 'dot') g.kind = 'bubble';
      continue;
    }
    const [hx, hy] = home(p, v);
    groups.set(key, { kind: l.type === 'shelter' ? 'house' : 'dot', members: [p], name: l.type === 'shelter' ? l.name : p.pet.place.name, hx, hy, x: hx, y: hy, r: 0 });
  }
  // Zoomed in, only what's in view takes part.
  let out = [...groups.values()].filter((m) => Math.abs(m.hx) < VIEW + 12 && Math.abs(m.hy) < VIEW + 12);
  for (const m of out) m.r = footprint(m);

  // Nudge: push overlapping pairs apart, but never more than NUDGE px from where they belong.
  for (let pass = 0; pass < 10; pass++) {
    for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        const a = out[i], b = out[j];
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.hypot(dx, dy) || 0.01;
        const gap = a.r + b.r + 1.5;
        if (d >= gap) continue;
        const push = (gap - d) / 2;
        a.x -= (dx / d) * push; a.y -= (dy / d) * push;
        b.x += (dx / d) * push; b.y += (dy / d) * push;
      }
    }
    for (const m of out) {
      const ox = m.x - m.hx, oy = m.y - m.hy;
      const off = Math.hypot(ox, oy);
      if (off > NUDGE) (m.x = m.hx + (ox / off) * NUDGE), (m.y = m.hy + (oy / off) * NUDGE);
      clamp(m, v);
    }
  }

  // Merge whatever still overlaps into a bubble at the members' weighted centre; repeat until clear.
  for (let merged = true; merged; ) {
    merged = false;
    outer: for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        const a = out[i], b = out[j];
        if (Math.hypot(b.x - a.x, b.y - a.y) >= a.r + b.r - 1) continue;
        const na = a.members.length, nb = b.members.length;
        const hx = (a.hx * na + b.hx * nb) / (na + nb), hy = (a.hy * na + b.hy * nb) / (na + nb);
        const m: Marker = { kind: 'bubble', members: [...a.members, ...b.members], name: na >= nb ? a.name : b.name, hx, hy, x: hx, y: hy, r: 0 };
        m.r = footprint(m);
        clamp(m, v);
        out = [...out.slice(0, i), ...out.slice(i + 1, j), ...out.slice(j + 1), m];
        merged = true;
        break outer;
      }
    }
  }
  // Houses and bubbles paint last so their counts sit on top of nearby dots.
  return out.sort((a, b) => Number(a.kind !== 'dot') - Number(b.kind !== 'dot'));
}

/** Private pets that all live in one neighbourhood: a bubble that filters to that place when tapped. */
const onePlace = (m: Marker) => m.members.every((q) => q.pet.lister.type === 'private' && q.pet.place.id === m.members[0].pet.place.id);

function dots(list: Marker[]): Raw {
  return html`${list.map((m, i) => {
    const x = m.x.toFixed(1);
    const y = m.y.toFixed(1);
    if (m.kind === 'dot') {
      const p = m.members[0];
      return html`<circle class="radar__dot" data-m="${i}" role="button" tabindex="0" aria-label="${t('radar.openPet', { name: p.pet.name, place: p.pet.place.name })}" data-frame="${frameFor(p.pet.id)}" cx="${x}" cy="${y}" r="6.5"><title>${p.pet.name} · ${p.pet.place.name}</title></circle>`;
    }
    if (m.kind === 'house') {
      const l = m.members[0].pet.lister;
      return html`<g class="radar__house" data-m="${i}" role="button" tabindex="0" data-frame="${frameFor(l.type === 'shelter' ? l.id : '')}" transform="translate(${x} ${y})"><title data-m-title></title><path d="${HOUSE}" /><g class="radar__badge" data-m-badge><rect x="2" y="-13" height="10" rx="5" /><text y="-8" data-m-n></text></g></g>`;
    }
    return html`<g class="radar__bubble" data-m="${i}" role="button" tabindex="0" transform="translate(${x} ${y})"><title data-m-title></title><circle r="${m.r}" /><text class="radar__bubble-n" y="0.5" data-m-n></text></g>`;
  })}`;
}

function radar(): Raw {
  return html`
    <div class="radar-stage">
      <svg class="radar" viewBox="-150 -150 300 300" role="group" aria-labelledby="radar-label" data-map>
        <title id="radar-label">${t('sheet.radius.label')}</title>
        <g data-zoom-layer>
          <circle class="radar__disk" r="${R}" />
          ${RINGS.map((km) => html`<circle class="radar__ring" r="${rOf(km).toFixed(1)}" />`)}
        </g>
        <g data-ring-labels>${RINGS.map((km) => html`<text class="radar__ring-label" data-km="${km}">${km}</text>`)}</g>
        <g data-dots></g>
        <g data-you><circle class="radar__you-halo" r="11" /><circle class="radar__you" r="5.5" /></g>
      </svg>
      <div class="radar__zoom">
        <button class="radar__zoom-btn" type="button" data-zoom-in aria-label="${t('radar.zoomIn')}">${icon(Plus, 16)}</button>
        <button class="radar__zoom-btn" type="button" data-zoom-out aria-label="${t('radar.zoomOut')}">${icon(Minus, 16)}</button>
      </div>
    </div>
    <p class="radar__from" data-from hidden><button class="from-chip" type="button" data-from-clear><span data-from-label></span>${icon(X, 14)}</button></p>`;
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

  // ---------- The map: zoom, markers, and what a tap on a marker does ----------
  const svg = $('[data-map]', root) as unknown as SVGSVGElement;
  const zoomIn = $<HTMLButtonElement>('[data-zoom-in]', root);
  const zoomOut = $<HTMLButtonElement>('[data-zoom-out]', root);
  const fromRow = $('[data-from]', root);
  const view: View = { z: 1, cx: 0, cy: 0 };
  let shown: Marker[] = [];

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
    const from = draft.filters.from;
    fromRow.hidden = !from;
    if (from) $('[data-from-label]', root).textContent = t('radar.only', { name: from.name });
    $('[data-from-clear]', root).setAttribute('aria-label', from ? t('radar.clearFrom', { name: from.name }) : '');
    for (const el of $$<SVGElement>('[data-m]', root)) {
      const m = shown[Number(el.dataset.m)];
      if (!m) continue;
      const matching = m.members.filter((q) => matchesFilters(q.pet, draft.filters)).length;
      el.classList.toggle('is-in', m.members.some((q) => q.km <= km));
      el.classList.toggle('is-filtered', matching === 0);
      if (m.kind === 'dot') continue;
      const countText = m.kind === 'house' && matching < 2 ? '' : matching > 999 ? '999+' : matching ? String(matching) : '';
      $('[data-m-n]', el).textContent = countText;
      if (m.kind === 'house') {
        // The count rides on the roof's corner as a small ink badge, sized to its digits.
        const w = 6 + countText.length * 5;
        $('[data-m-badge]', el).toggleAttribute('hidden', !countText);
        $('[data-m-badge] rect', el).setAttribute('width', String(w));
        $('[data-m-badge] text', el).setAttribute('x', String(2 + w / 2));
      }
      const label = `${m.kind === 'bubble' ? t('radar.near', { place: m.name }) : m.name} · ${matching} ${animals(matching, state.species)}`;
      $('[data-m-title]', el).textContent = label;
      el.setAttribute('aria-label', label);
      const chosen = !!from && (m.kind === 'house' ? from.kind === 'shelter' && m.members[0].pet.lister.type === 'shelter' && m.members[0].pet.lister.id === from.id : from.kind === 'place' && onePlace(m) && m.members[0].pet.place.id === from.id);
      el.classList.toggle('is-chosen', chosen);
      if (m.kind === 'house' || onePlace(m)) el.setAttribute('aria-pressed', String(chosen));
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

  /** New pets, a new origin or a new zoom: lay the markers out again, keep the disk and its transition. */
  const draw = () => {
    const [ux, uy] = you(view);
    $('[data-zoom-layer]', root).setAttribute('transform', `translate(${ux.toFixed(1)} ${uy.toFixed(1)}) scale(${view.z})`);
    $('[data-you]', root).setAttribute('transform', `translate(${ux.toFixed(1)} ${uy.toFixed(1)})`);
    for (const l of $$<SVGTextElement>('[data-km]', root)) {
      const y = uy - rOf(Number(l.dataset.km)) * view.z - 3;
      l.setAttribute('x', ux.toFixed(1));
      l.setAttribute('y', y.toFixed(1));
      l.toggleAttribute('hidden', Math.abs(ux) > VIEW - 8 || y < -VIEW + 8 || y > VIEW);
    }
    // Re-rendering replaces the markers; keep keyboard focus on the same one.
    const key = (m?: Marker) => (m ? `${m.kind}:${m.members[0].pet.id}` : '');
    const active = document.activeElement as HTMLElement | SVGElement | null;
    const focused = active && root.contains(active) && active.dataset.m !== undefined ? key(shown[Number(active.dataset.m)]) : '';
    shown = markers(view);
    mount($('[data-dots]', root), dots(shown));
    const again = focused ? shown.findIndex((m) => key(m) === focused) : -1;
    if (again >= 0) $<HTMLElement>(`[data-m="${again}"]`, root).focus({ preventScroll: true });
    zoomIn.disabled = view.z >= Z_MAX;
    zoomOut.disabled = view.z <= 1;
    // Zoomed out, a swipe over the map still scrolls the panel; zoomed in, it pans the map.
    svg.classList.toggle('is-zoomed', view.z > 1);
    paint();
  };
  let frame = 0;
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(() => ((frame = 0), draw()));
  };
  const redraw = () => {
    $('[data-location]', root).textContent = fromLabel();
    draw();
  };

  /** Zoom to z around a map point (in unzoomed map units), keeping the view over the disk. */
  const setView = (z: number, cx: number, cy: number) => {
    view.z = Math.min(Z_MAX, Math.max(1, z));
    const lim = Math.max(0, R - VIEW / view.z);
    const d = Math.hypot(cx, cy);
    const k = d > lim ? lim / (d || 1) : 1;
    view.cx = cx * k;
    view.cy = cy * k;
    schedule();
  };
  /** Zoom by a factor, keeping the screen point (sx, sy) where it is. */
  const zoomAt = (factor: number, sx: number, sy: number) => {
    const bx = sx / view.z + view.cx, by = sy / view.z + view.cy;
    const z = Math.min(Z_MAX, Math.max(1, view.z * factor));
    setView(z, bx - sx / z, by - sy / z);
  };
  const toView = (e: { clientX: number; clientY: number }): [number, number] => {
    const box = svg.getBoundingClientRect();
    return [((e.clientX - box.left) / box.width) * 2 * VIEW - VIEW, ((e.clientY - box.top) / box.height) * 2 * VIEW - VIEW];
  };

  zoomIn.addEventListener('click', () => zoomAt(2, 0, 0));
  zoomOut.addEventListener('click', () => zoomAt(0.5, 0, 0));
  // Plain wheel scrolls the panel; Ctrl/⌘ + wheel (and a trackpad pinch, which sends the same) zooms.
  svg.addEventListener(
    'wheel',
    (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const [sx, sy] = toView(e);
      zoomAt(Math.exp(-e.deltaY * 0.01), sx, sy);
    },
    { passive: false },
  );

  /** A tap on a marker: a house filters to that shelter, a dot opens its pet, a neighbourhood bubble
   *  filters to its private listings, and a mixed bubble zooms in until it splits. */
  const activate = (el: Element) => {
    const m = shown[Number((el as HTMLElement).dataset.m)];
    if (!m) return;
    const first = m.members[0];
    if (m.kind === 'dot') return void (location.hash = `/mascota/${encodeURIComponent(first.pet.id)}`);
    let next: Filters['from'] = null;
    if (m.kind === 'house' && first.pet.lister.type === 'shelter') next = { kind: 'shelter', id: first.pet.lister.id, name: first.pet.lister.name };
    else if (onePlace(m)) next = { kind: 'place', id: first.pet.place.id, name: t('radar.privateIn', { place: first.pet.place.name }) };
    if (!next) {
      if (view.z < Z_MAX) setView(view.z * 2.5, m.x / view.z + view.cx, m.y / view.z + view.cy);
      return;
    }
    const same = draft.filters.from?.kind === next.kind && draft.filters.from.id === next.id;
    draft.filters.from = same ? null : next;
    // Choosing a shelter beyond the radius widens it just enough to include it.
    const far = Math.ceil(Math.max(...m.members.map((q) => q.km)));
    if (!same && far > draft.radiusKm) {
      draft.radiusKm = Math.min(RADIUS_MAX, far);
      slider.value = String(toSlider(draft.radiusKm));
    }
    paint();
    commit();
  };
  $('[data-from-clear]', root).addEventListener('click', () => {
    draft.filters.from = null;
    paint();
    commit();
  });
  svg.addEventListener('keydown', (e) => {
    const el = (e.target as Element).closest('[data-m]');
    if (el && (e.key === 'Enter' || e.key === ' ')) (e.preventDefault(), activate(el));
  });

  // Pointers: a still tap activates a marker; one finger (or the mouse) pans once zoomed; two fingers pinch.
  const pointers = new Map<number, { x: number; y: number }>();
  let tap: { el: Element | null; x: number; y: number } | null = null;
  svg.addEventListener('pointerdown', (e) => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    tap = pointers.size === 1 ? { el: (e.target as Element).closest('[data-m]'), x: e.clientX, y: e.clientY } : null;
  });
  svg.addEventListener('pointermove', (e) => {
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    if (tap && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > 6) tap = null;
    const box = svg.getBoundingClientRect();
    const unit = (2 * VIEW) / box.width;
    if (pointers.size === 2) {
      const [a, b] = [...pointers.entries()].map(([id, p]) => (id === e.pointerId ? { x: e.clientX, y: e.clientY } : p));
      const [pa, pb] = [...pointers.values()];
      const before = Math.hypot(pa.x - pb.x, pa.y - pb.y) || 1;
      const after = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      svg.setPointerCapture(e.pointerId);
      zoomAt(after / before, ...toView({ clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 }));
    } else if (view.z > 1 && !tap) {
      svg.setPointerCapture(e.pointerId);
      setView(view.z, view.cx - ((e.clientX - prev.x) * unit) / view.z, view.cy - ((e.clientY - prev.y) * unit) / view.z);
    }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  });
  const lift = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    if (e.type === 'pointerup' && tap?.el && pointers.size === 0) activate(tap.el);
    tap = null;
  };
  svg.addEventListener('pointerup', lift);
  svg.addEventListener('pointercancel', lift);

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
    draft.filters = emptyFilters();
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

  draw();
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
