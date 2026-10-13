import { Heart, Mail } from 'lucide';
import { CONTACT_EMAIL, dogById, shelterById, type Dog } from '../data';
import { $, $$, html, icon, mount, type Raw } from '../dom';
import { formatKm, t } from '../i18n';
import { isSaved, MAX_SLOTS, placedById, stashPendingSave, state, takePendingSave, update, type Answer, type Answers, type SavedDog } from '../store';
import { renderAuth } from './auth';
import { miniFrame } from './canvas';
import { closeSheet, openSheet } from './sheet';
import { toast } from './toast';

// Saving is deliberate: full list → choose what to release; then reflect; then (if needed) sign in.

type Done = (saved: boolean) => void;

export function startSave(dogId: string, done: Done = () => {}) {
  if (isSaved(dogId)) return done(true);
  if (state.list.length >= MAX_SLOTS) return openFull(dogId, done);
  openReflect(dogId, done);
}

const pronoun = (dog: Dog) => (dog.sex === 'hembra' ? 'la' : 'lo');

function cautions(dog: Dog): string[] {
  const out: string[] = [];
  if (dog.goodWith.gatos === false) out.push(t('reflect.notCats'));
  if (dog.goodWith.perros === false) out.push(t('reflect.notDogs'));
  if (dog.goodWith.ninos === false) out.push(t('reflect.notKids'));
  return [...out, ...dog.needs];
}

function question(name: keyof Answers, text: string): Raw {
  return html`
    <fieldset class="question">
      <legend>${text}</legend>
      <div class="segmented">
        <label><input type="radio" name="${name}" value="si" /><span>${t('reflect.yes')}</span></label>
        <label><input type="radio" name="${name}" value="pensando" /><span>${t('reflect.unsure')}</span></label>
      </div>
    </fieldset>`;
}

function openReflect(dogId: string, done: Done) {
  const dog = dogById.get(dogId)!;
  const p = placedById.get(dogId)!;
  const lo = pronoun(dog);
  const slot = state.list.length + 1;
  const body = html`
    <form class="reflect" id="reflect-form">
      <div class="reflect__intro">
        ${miniFrame(dog)}
        <div>
          <p class="reflect__dog">${dog.name} · ${t('deck.away', { km: formatKm(p.km) })}</p>
          <p class="muted">${t('reflect.body')}</p>
          <p class="reflect__slot">${t('reflect.slot', { n: slot })}</p>
        </div>
      </div>
      ${question('space', dog.size === 'grande' ? t('reflect.q.space.big', { name: dog.name }) : t('reflect.q.space'))}
      ${question('time', dog.energy === 'alta' ? t('reflect.q.time.high', { name: dog.name, lo }) : t('reflect.q.time', { lo }))}
      ${question('cost', t('reflect.q.cost'))}
      <div class="mind">
        <h3 class="mind__title">${t('reflect.mind')}</h3>
        <ul class="mind__list">${cautions(dog).map((c) => html`<li>${c}</li>`)}</ul>
      </div>
      <p class="unsure-note" hidden data-unsure>${t('reflect.unsureNote', { lo })}</p>
    </form>`;
  const footer = html`
    <button class="button button--ghost" type="button" data-cancel>${t('reflect.cancel')}</button>
    <button class="button button--primary" type="submit" form="reflect-form" disabled data-save>${icon(Heart, 18)}<span>${t('reflect.answerAll')}</span></button>`;

  let saved = false;
  const dialog = openSheet(t('reflect.title', { name: dog.name }), body, { footer, onClose: () => done(saved) });
  const form = $<HTMLFormElement>('#reflect-form', dialog);
  const saveBtn = $<HTMLButtonElement>('[data-save]', dialog);
  const read = (): Partial<Answers> => Object.fromEntries(new FormData(form)) as Partial<Answers>;

  form.addEventListener('change', () => {
    const a = read();
    const complete = !!(a.space && a.time && a.cost);
    saveBtn.disabled = !complete;
    $('span', saveBtn).textContent = complete ? t('reflect.save') : t('reflect.answerAll');
    $('[data-unsure]', dialog).hidden = !Object.values(a).includes('pensando' as Answer);
  });
  $('[data-cancel]', dialog).addEventListener('click', () => closeSheet());
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const answers = read() as Answers;
    const commit = () => {
      update((s) => s.list.push({ dogId, savedAt: new Date().toISOString(), answers }));
      saved = true;
      closeSheet();
      toast(`${dog.name} · ${t('profile.saved')} (${state.list.length} de ${MAX_SLOTS})`);
    };
    if (state.signedIn) commit();
    else showAuth(dog, { dogId, savedAt: new Date().toISOString(), answers }, commit, () => done(saved));
  });
}

function showAuth(dog: Dog, pending: SavedDog, onSignedIn: () => void, onClose: () => void) {
  const dialog = openSheet(
    t('auth.title', { name: dog.name }),
    html`<p class="muted auth__intro">${t('auth.body')}</p><div data-auth></div>`,
    { onClose },
  );
  renderAuth($('[data-auth]', dialog), {
    next: location.hash || '#/',
    // Google and the email link leave this page; the save finishes when the user returns signed in.
    beforeRedirect: () => stashPendingSave(pending),
    onSignedIn: () => {
      takePendingSave();
      onSignedIn();
    },
  });
}

/** Finishes a save that was interrupted by a sign-in redirect. */
export function resumePendingSave() {
  const pending = takePendingSave();
  if (!pending || !state.signedIn || isSaved(pending.dogId) || state.list.length >= MAX_SLOTS) return;
  const dog = dogById.get(pending.dogId);
  if (!dog) return;
  update((s) => s.list.push(pending));
  toast(`${dog.name} · ${t('profile.saved')} (${state.list.length} de ${MAX_SLOTS})`);
}

function openFull(dogId: string, done: Done) {
  const dog = dogById.get(dogId)!;
  const subject = encodeURIComponent(t('full.manySubject'));
  const mailBody = encodeURIComponent(`Hola, me interesa adoptar a ${dog.name} y a otros perros más.`);
  const body = html`
    <div class="full">
      <p class="muted">${t('full.body', { name: dog.name })}</p>
      <ul class="full__slots">
        ${state.list.map((s) => {
          const d = dogById.get(s.dogId)!;
          const shelter = shelterById.get(d.shelterId)!;
          return html`<li class="full__slot">
            ${miniFrame(d, 'sm')}
            <span class="full__slot-text"><strong>${d.name}</strong><span class="muted">${shelter.name}</span></span>
            <button class="button button--outline button--small" type="button" data-release="${d.id}">${t('full.release')}</button>
          </li>`;
        })}
      </ul>
      <div class="many">
        <h3 class="many__title">${t('full.manyTitle')}</h3>
        <p>${t('full.manyBody')}</p>
        <a class="button button--ink" href="mailto:${CONTACT_EMAIL}?subject=${subject}&body=${mailBody}">${icon(Mail, 18)}${t('full.manyCta')}</a>
      </div>
    </div>`;
  let handedOff = false;
  const dialog = openSheet(t('full.title'), body, { onClose: () => !handedOff && done(false) });
  $$<HTMLButtonElement>('[data-release]', dialog).forEach((b) =>
    b.addEventListener('click', () => {
      update((s) => (s.list = s.list.filter((x) => x.dogId !== b.dataset.release)));
      handedOff = true;
      openReflect(dogId, done);
    }),
  );
}

export function removeFromList(dogId: string) {
  update((s) => (s.list = s.list.filter((x) => x.dogId !== dogId)));
}

/** Re-render helper for any element showing the 3 slot pips. */
export function pips(withCount = false): Raw {
  return html`<span class="pips" aria-hidden="true">${Array.from({ length: MAX_SLOTS }, (_, i) => {
    const s = state.list[i];
    return html`<span class="pip" ${s ? html`data-frame="${dogById.get(s.dogId)!.frame}"` : ''}></span>`;
  })}${withCount ? html`<span class="pips__count">${state.list.length}/${MAX_SLOTS}</span>` : ''}</span>`;
}

export function mountPips(el: Element) {
  mount(el, pips(el.hasAttribute('data-pips-count')));
}
