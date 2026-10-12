import { ArrowLeft, Check, CircleHelp, Clock, Heart, House, X } from 'lucide';
import { shelterById, type Companion } from '../data';
import { $, html, icon, mount, type Raw } from '../dom';
import { formatDate, formatKm, t } from '../i18n';
import { isSaved, placedById, update } from '../store';
import { canvas } from '../ui/canvas';
import { removeFromList, startSave } from '../ui/save';
import { toast } from '../ui/toast';

interface ProfileDeps {
  back: () => void;
}

function status(value: boolean | null, yes = t('profile.yes'), no = t('profile.no')): Raw {
  if (value === true) return html`<span class="status status--yes">${icon(Check, 16)}${yes}</span>`;
  if (value === false) return html`<span class="status status--no">${icon(X, 16)}${no}</span>`;
  return html`<span class="status status--unknown">${icon(CircleHelp, 16)}${t('profile.unknown')}</span>`;
}

export function renderProfile(root: HTMLElement, id: string, deps: ProfileDeps) {
  const p = placedById.get(id);
  if (!p) return deps.back();
  const { dog } = p;
  const shelter = shelterById.get(dog.shelterId)!;
  const saved = isSaved(dog.id);
  const companions: Companion[] = ['ninos', 'perros', 'gatos'];

  mount(
    root,
    html`
      <article class="profile" aria-labelledby="dog-name">
        <div class="profile__media">
          <button class="icon-button icon-button--float profile__back" type="button" data-back aria-label="${t('profile.back')}">${icon(ArrowLeft, 22)}</button>
          ${canvas(p, { heading: 'h1', photoName: 'dog-photo' })}
        </div>

        <div class="profile__body">
          <section class="profile__section">
            <h2 class="section-title">${t('profile.story')}</h2>
            <p class="profile__story">${dog.story}</p>
          </section>

          <section class="profile__section">
            <h2 class="section-title">${t('profile.needs')}</h2>
            <ul class="needs">${dog.needs.map((n) => html`<li>${n}</li>`)}</ul>
          </section>

          <div class="profile__pair">
            <section class="profile__section">
              <h2 class="section-title">${t('profile.goodWith')}</h2>
              <dl class="status-list">
                ${companions.map((c) => html`<div><dt>${t(`companion.${c}`)}</dt><dd>${status(dog.goodWith[c])}</dd></div>`)}
              </dl>
            </section>
            <section class="profile__section">
              <h2 class="section-title">${t('profile.health')}</h2>
              <dl class="status-list">
                ${(['vacunas', 'esterilizacion', 'desparasitacion'] as const).map(
                  (k) => html`<div><dt>${t(`health.${k}`)}</dt><dd>${status(dog.health[k], t('health.done'), t('health.pending'))}</dd></div>`,
                )}
              </dl>
            </section>
          </div>

          <section class="profile__section shelter">
            <h2 class="section-title">${t('profile.shelter')}</h2>
            <div class="shelter__card">
              <span class="shelter__mark" aria-hidden="true">${icon(House, 22)}</span>
              <div>
                <p class="shelter__name">${shelter.name}</p>
                <p class="muted">${shelter.sector}, ${shelter.city} · ${t('deck.away', { km: formatKm(p.km) })}</p>
                <p class="shelter__meta"><strong>${t('profile.visits')}:</strong> ${shelter.visitHours}</p>
                <p class="shelter__meta">${t('profile.inShelter', { date: formatDate(dog.arrived, { day: 'numeric', month: 'long', year: 'numeric' }) })}</p>
              </div>
            </div>
            <p class="sample-note">${t('profile.sampleShelter')}</p>
          </section>
        </div>

        <div class="profile__bar">
          ${saved
            ? html`<span class="saved-tag">${icon(Check, 18)}${t('profile.saved')}</span>
                <button class="button button--outline" type="button" data-remove>${t('profile.remove')}</button>`
            : html`<button class="button button--outline" type="button" data-skip>${icon(Clock, 20)}${t('deck.skip')}</button>
                <button class="button button--primary" type="button" data-save>${icon(Heart, 20)}${t('profile.save')}</button>`}
        </div>
      </article>`,
  );

  $('[data-back]', root).addEventListener('click', deps.back);
  root.querySelector('[data-save]')?.addEventListener('click', () => startSave(dog.id));
  root.querySelector('[data-remove]')?.addEventListener('click', () => removeFromList(dog.id));
  root.querySelector('[data-skip]')?.addEventListener('click', () => {
    update((s) => s.skipped.push(dog.id));
    toast(t('deck.skipped', { name: dog.name }));
    deps.back();
  });
}
